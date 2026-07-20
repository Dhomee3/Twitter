import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
  SlashCommandBuilder,
  ActivityType,
  PresenceUpdateStatus,
  type Interaction,
  type ChatInputCommandInteraction,
  type StringSelectMenuInteraction,
  type ModalSubmitInteraction,
  type ButtonInteraction,
  type TextChannel,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord.js";
import mongoose, { Schema } from "mongoose";
import http from "http";

// ═══════════════════════════════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════════════════════════════

type TwitterAccount = {
  id: number;
  discordUserId: string;
  guildId: string;
  username: string;
  displayName: string;
  verified: boolean;
  starred: boolean;
  banned: boolean;
  avatarUrl: string | null;
  bonusFollowers: number;
  createdAt: Date;
};

type TwitterTweet = {
  id: number;
  authorId: number | null;
  guildId: string;
  content: string;
  imageUrl: string | null;
  messageId: string | null;
  channelId: string | null;
  likeCount: number;
  createdAt: Date;
};

type TwitterComment = {
  id: number;
  tweetId: number | null;
  authorId: number | null;
  content: string;
  createdAt: Date;
};

// ═══════════════════════════════════════════════════════════════════
//  MONGODB SCHEMAS & MODELS
// ═══════════════════════════════════════════════════════════════════

const CounterSchema = new Schema({ _id: String, seq: { type: Number, default: 0 } });
const Counter = mongoose.model("Counter", CounterSchema);

async function nextId(name: string): Promise<number> {
  const doc = await Counter.findByIdAndUpdate(
    name,
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return doc!.seq;
}

const SettingsSchema = new Schema({
  guildId: { type: String, required: true, unique: true },
  tweetChannelId: String,
  logChannelId: String,
});
const Settings = mongoose.model("Settings", SettingsSchema);

const AccountSchema = new Schema({
  id: { type: Number, unique: true },
  discordUserId: { type: String, required: true },
  guildId: { type: String, required: true },
  username: { type: String, required: true },
  displayName: { type: String, required: true },
  verified: { type: Boolean, default: false },
  starred: { type: Boolean, default: false },
  banned: { type: Boolean, default: false },
  avatarUrl: String,
  bonusFollowers: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});
AccountSchema.index({ discordUserId: 1, guildId: 1 }, { unique: true });
AccountSchema.index({ username: 1, guildId: 1 }, { unique: true });
const Account = mongoose.model("Account", AccountSchema);

const TweetSchema = new Schema({
  id: { type: Number, unique: true },
  authorId: Number,
  guildId: { type: String, required: true },
  content: { type: String, required: true },
  imageUrl: String,
  messageId: String,
  channelId: String,
  likeCount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});
const Tweet = mongoose.model("Tweet", TweetSchema);

const LikeSchema = new Schema({
  accountId: { type: Number, required: true },
  tweetId: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now },
});
LikeSchema.index({ accountId: 1, tweetId: 1 }, { unique: true });
const Like = mongoose.model("Like", LikeSchema);

const FollowSchema = new Schema({
  followerId: { type: Number, required: true },
  followingId: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now },
});
FollowSchema.index({ followerId: 1, followingId: 1 }, { unique: true });
const Follow = mongoose.model("Follow", FollowSchema);

const CommentSchema = new Schema({
  id: { type: Number, unique: true },
  tweetId: Number,
  authorId: Number,
  content: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});
const Comment = mongoose.model("Comment", CommentSchema);

const LogSchema = new Schema({
  guildId: { type: String, required: true },
  action: { type: String, required: true },
  targetDiscordId: String,
  moderatorDiscordId: String,
  details: String,
  createdAt: { type: Date, default: Date.now },
});
const Log = mongoose.model("Log", LogSchema);

// ═══════════════════════════════════════════════════════════════════
//  DOC → TYPE CONVERTERS
// ═══════════════════════════════════════════════════════════════════

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toAccount(d: any): TwitterAccount {
  return {
    id: d.id, discordUserId: d.discordUserId, guildId: d.guildId,
    username: d.username, displayName: d.displayName,
    verified: d.verified ?? false, starred: d.starred ?? false, banned: d.banned ?? false,
    avatarUrl: d.avatarUrl ?? null, bonusFollowers: d.bonusFollowers ?? 0,
    createdAt: d.createdAt ?? new Date(),
  };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toTweet(d: any): TwitterTweet {
  return {
    id: d.id, authorId: d.authorId ?? null, guildId: d.guildId, content: d.content,
    imageUrl: d.imageUrl ?? null, messageId: d.messageId ?? null, channelId: d.channelId ?? null,
    likeCount: d.likeCount ?? 0, createdAt: d.createdAt ?? new Date(),
  };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toComment(d: any): TwitterComment {
  return { id: d.id, tweetId: d.tweetId ?? null, authorId: d.authorId ?? null, content: d.content, createdAt: d.createdAt ?? new Date() };
}

// ═══════════════════════════════════════════════════════════════════
//  MODULE-LEVEL CLIENT REF
// ═══════════════════════════════════════════════════════════════════

let botClient: Client | null = null;

// ═══════════════════════════════════════════════════════════════════
//  ✏️  CONFIG — تقدر تعدل هنا يدوياً
// ═══════════════════════════════════════════════════════════════════

const ADMIN_ROLE_ID = "1515771920174551051";

// ═══════════════════════════════════════════════════════════════════
//  DATABASE HELPERS
// ═══════════════════════════════════════════════════════════════════

async function getSettings(guildId: string) {
  return Settings.findOne({ guildId }).lean();
}

async function setTweetChannel(guildId: string, channelId: string) {
  await Settings.findOneAndUpdate({ guildId }, { $set: { tweetChannelId: channelId } }, { upsert: true });
}

async function setLogChannel(guildId: string, channelId: string) {
  await Settings.findOneAndUpdate({ guildId }, { $set: { logChannelId: channelId } }, { upsert: true });
}

async function getAccount(discordUserId: string, guildId: string): Promise<TwitterAccount | null> {
  const d = await Account.findOne({ discordUserId, guildId }).lean();
  return d ? toAccount(d) : null;
}

async function getAccountById(id: number): Promise<TwitterAccount | null> {
  const d = await Account.findOne({ id }).lean();
  return d ? toAccount(d) : null;
}

async function getAccountByUsername(username: string, guildId: string): Promise<TwitterAccount | null> {
  const d = await Account.findOne({ username: new RegExp(`^${username.replace("@", "")}$`, "i"), guildId }).lean();
  return d ? toAccount(d) : null;
}

async function resolveTarget(target: string, guildId: string): Promise<TwitterAccount | null> {
  const cleaned = target.replace(/[<@!>]/g, "").trim();
  return (await getAccount(cleaned, guildId)) ?? (await getAccountByUsername(cleaned, guildId));
}

async function createAccount(discordUserId: string, guildId: string, username: string, displayName: string, avatarUrl: string | null): Promise<TwitterAccount> {
  const id = await nextId("account");
  const d = await Account.create({ id, discordUserId, guildId, username, displayName, avatarUrl, createdAt: new Date() });
  return toAccount(d);
}

async function updateAvatar(id: number, avatarUrl: string) {
  await Account.updateOne({ id }, { $set: { avatarUrl } });
}

async function changeUsername(id: number, newUsername: string) {
  await Account.updateOne({ id }, { $set: { username: newUsername } });
}

async function verifyAccount(id: number, state: boolean) {
  await Account.updateOne({ id }, { $set: { verified: state } });
}

async function starAccount(id: number, state: boolean) {
  await Account.updateOne({ id }, { $set: { starred: state } });
}

async function banAccount(id: number, state: boolean) {
  await Account.updateOne({ id }, { $set: { banned: state } });
}

async function deleteAccount(id: number) {
  await Account.deleteOne({ id });
  await Tweet.deleteMany({ authorId: id });
  await Like.deleteMany({ accountId: id });
  await Follow.deleteMany({ $or: [{ followerId: id }, { followingId: id }] });
  await Comment.deleteMany({ authorId: id });
}

async function addBonusFollowers(accountId: number, amount: number) {
  await Account.updateOne({ id: accountId }, { $inc: { bonusFollowers: amount } });
}

async function removeBonusFollowers(accountId: number, amount: number) {
  const d = await Account.findOne({ id: accountId });
  if (!d) return;
  await Account.updateOne({ id: accountId }, { $set: { bonusFollowers: Math.max(0, (d.bonusFollowers ?? 0) - amount) } });
}

async function createTweet(authorId: number, guildId: string, content: string, imageUrl?: string): Promise<TwitterTweet> {
  const id = await nextId("tweet");
  const d = await Tweet.create({ id, authorId, guildId, content, imageUrl: imageUrl ?? null, createdAt: new Date() });
  return toTweet(d);
}

async function getTweet(id: number): Promise<TwitterTweet | null> {
  const d = await Tweet.findOne({ id }).lean();
  return d ? toTweet(d) : null;
}

async function updateTweetMessage(id: number, messageId: string, channelId: string) {
  await Tweet.updateOne({ id }, { $set: { messageId, channelId } });
}

async function deleteTweet(id: number) {
  await Tweet.deleteOne({ id });
  await Like.deleteMany({ tweetId: id });
  await Comment.deleteMany({ tweetId: id });
}

async function addBonusLikes(tweetId: number, amount: number) {
  await Tweet.updateOne({ id: tweetId }, { $inc: { likeCount: amount } });
}

async function removeBonusLikes(tweetId: number, amount: number) {
  const d = await Tweet.findOne({ id: tweetId });
  if (!d) return;
  await Tweet.updateOne({ id: tweetId }, { $set: { likeCount: Math.max(0, (d.likeCount ?? 0) - amount) } });
}

async function getAllAccounts(guildId: string): Promise<TwitterAccount[]> {
  const docs = await Account.find({ guildId }).sort({ createdAt: -1 }).lean();
  return docs.map(toAccount);
}

async function toggleLike(accountId: number, tweetId: number): Promise<boolean> {
  const existing = await Like.findOne({ accountId, tweetId });
  if (existing) {
    await Like.deleteOne({ accountId, tweetId });
    const d = await Tweet.findOne({ id: tweetId });
    await Tweet.updateOne({ id: tweetId }, { $set: { likeCount: Math.max(0, (d?.likeCount ?? 1) - 1) } });
    return false;
  } else {
    await Like.create({ accountId, tweetId });
    await Tweet.updateOne({ id: tweetId }, { $inc: { likeCount: 1 } });
    return true;
  }
}

async function getFollowersCount(accountId: number): Promise<number> {
  const [real, bonusDoc] = await Promise.all([
    Follow.countDocuments({ followingId: accountId }),
    Account.findOne({ id: accountId }, { bonusFollowers: 1 }).lean(),
  ]);
  return real + (bonusDoc?.bonusFollowers ?? 0);
}

async function getFollowingCount(accountId: number): Promise<number> {
  return Follow.countDocuments({ followerId: accountId });
}

async function toggleFollow(followerId: number, followingId: number): Promise<boolean | null> {
  if (followerId === followingId) return null;
  const existing = await Follow.findOne({ followerId, followingId });
  if (existing) {
    await Follow.deleteOne({ followerId, followingId });
    return false;
  } else {
    await Follow.create({ followerId, followingId });
    return true;
  }
}

async function createComment(tweetId: number, authorId: number, content: string): Promise<TwitterComment> {
  const id = await nextId("comment");
  const d = await Comment.create({ id, tweetId, authorId, content, createdAt: new Date() });
  return toComment(d);
}

async function getCommentsCount(tweetId: number): Promise<number> {
  return Comment.countDocuments({ tweetId });
}

async function getTweetCount(authorId: number): Promise<number> {
  return Tweet.countDocuments({ authorId });
}

async function addLog(guildId: string, action: string, targetDiscordId: string | null, modDiscordId: string | null, details: string | null) {
  await Log.create({ guildId, action, targetDiscordId, moderatorDiscordId: modDiscordId, details });
  if (!botClient) return;
  try {
    const settings = await getSettings(guildId);
    if (!settings?.logChannelId) return;
    const mod = modDiscordId ? `<@${modDiscordId}>` : "النظام";
    const target = targetDiscordId ? `<@${targetDiscordId}>` : "—";
    const embed = new EmbedBuilder().setColor(0x5865f2)
      .setTitle(`📋 ${action}`)
      .addFields(
        { name: "👮 المشرف", value: mod, inline: true },
        { name: "👤 الشخص", value: target, inline: true },
        { name: "📝 التفاصيل", value: details ?? "—", inline: false },
      )
      .setFooter({ text: "🐦 X  •  سجل الإجراءات  •  © FTRP" })
      .setTimestamp();
    const ch = await botClient.channels.fetch(settings.logChannelId) as TextChannel;
    await ch.send({ embeds: [embed] });
  } catch { /* تجاهل أخطاء إرسال اللوق */ }
}

async function getLogs(guildId: string, limit = 10) {
  return Log.find({ guildId }).sort({ createdAt: -1 }).limit(limit).lean();
}

// ═══════════════════════════════════════════════════════════════════
//  SLASH COMMANDS
// ═══════════════════════════════════════════════════════════════════

function getCommands(): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
  return [
    new SlashCommandBuilder()
      .setName("twitter")
      .setDescription("🐦 نظام تويتر X")
      .addSubcommand((s) => s.setName("panel").setDescription("افتح بانل المواطنين"))
      .toJSON(),
    new SlashCommandBuilder()
      .setName("admin")
      .setDescription("⚙️ بانل الإدارة")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addSubcommand((s) => s.setName("panel").setDescription("افتح بانل الإدارة"))
      .addSubcommand((s) =>
        s.setName("logs").setDescription("عرض سجل الإجراءات")
          .addIntegerOption((o) => o.setName("limit").setDescription("عدد السجلات (1-25)").setMinValue(1).setMaxValue(25)),
      )
      .toJSON(),
  ];
}

// ═══════════════════════════════════════════════════════════════════
//  ADMIN ACCESS HELPER
// ═══════════════════════════════════════════════════════════════════

type RepliableWithGuild = {
  memberPermissions: Readonly<import("discord.js").PermissionsBitField> | null;
  member: import("discord.js").GuildMember | import("discord.js").APIInteractionGuildMember | null;
};

function hasAdminAccess(i: RepliableWithGuild): boolean {
  if (i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  if (!ADMIN_ROLE_ID) return false;
  const member = i.member;
  if (!member) return false;
  const roles = Array.isArray(member.roles)
    ? member.roles
    : [...(member.roles as import("discord.js").GuildMemberRoleManager).cache.keys()];
  return roles.includes(ADMIN_ROLE_ID);
}

// ═══════════════════════════════════════════════════════════════════
//  EMBED & COMPONENT BUILDERS
// ═══════════════════════════════════════════════════════════════════

const C = { BLUE: 0x1a2f6e, RED: 0x1a2f6e, GREEN: 0x1a2f6e, ERROR: 0xff4444, PURPLE: 0x1a2f6e, COMMENT: 0x1a2f6e };

const POLICE_AVATAR = "https://placehold.co/128x128/003087/FFFFFF/png?text=POLICE";
const POLICE_COLOR = 0x003087;

function badge(a: TwitterAccount) {
  return `${a.verified ? "✅ " : ""}${a.starred ? "⭐ " : ""}`;
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function tweetEmbed(tweet: TwitterTweet, account: TwitterAccount, followers: number, comments: number) {
  void followers;
  const embed = new EmbedBuilder().setColor(C.BLUE)
    .setAuthor({ name: `${badge(account)}${account.displayName} (@${account.username})`.trim(), iconURL: account.avatarUrl ?? undefined })
    .setDescription(tweet.content)
    .addFields(
      { name: "❤️ إعجابات", value: fmtNum(tweet.likeCount ?? 0), inline: true },
      { name: "💬 تعليقات", value: fmtNum(comments), inline: true },
    )
    .setFooter({ text: `🐦 X  •  #${tweet.id}  •  © FTRP` })
    .setTimestamp(tweet.createdAt ?? new Date());
  if (tweet.imageUrl) embed.setImage(tweet.imageUrl);
  return embed;
}

function tweetButtons(tweetId: number, authorId: number, likeCount: number) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`like_${tweetId}`).setLabel(`❤️  ${fmtNum(likeCount)}`).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`comment_${tweetId}`).setLabel("💬 تعليق").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`follow_${authorId}`).setLabel("👥 متابعة").setStyle(ButtonStyle.Primary),
  );
}

function commentEmbed(comment: TwitterComment, account: TwitterAccount, tweetId: number) {
  return new EmbedBuilder().setColor(C.COMMENT)
    .setAuthor({ name: `${badge(account)}${account.displayName} (@${account.username})`.trim(), iconURL: account.avatarUrl ?? undefined })
    .setDescription(comment.content)
    .setFooter({ text: `💬 رداً على التغريدة  #${tweetId}  •  🐦 X  •  © FTRP` })
    .setTimestamp(comment.createdAt ?? new Date());
}

function profileEmbed(account: TwitterAccount, followers: number, tweets: number) {
  const ts = Math.floor((account.createdAt ?? new Date()).getTime() / 1000);
  return new EmbedBuilder().setColor(C.BLUE)
    .setTitle(`${badge(account)}${account.displayName}`)
    .setDescription(`**@${account.username}**`)
    .setThumbnail(account.avatarUrl ?? null)
    .addFields(
      { name: "👥 المتابعون", value: followers.toLocaleString(), inline: true },
      { name: "🐦 التغريدات", value: tweets.toLocaleString(), inline: true },
      { name: "📊 الحالة", value: account.banned ? "🚫 محظور" : "✅ نشط", inline: true },
      { name: "📅 الانضمام", value: `<t:${ts}:D>`, inline: true },
    )
    .setFooter({ text: "🐦 X  •  © FTRP" });
}

function citizenPanel() {
  const embed = new EmbedBuilder().setColor(0x1a2f6e)
    .setTitle("مـنـصـة تـويـتـر ( X )")
    .setDescription("مرحباً! اختر ما تريد القيام به من القائمة أدناه:")
    .addFields(
      { name: "📝 إنشاء حساب", value: "أنشئ حسابك على Twitter X", inline: true },
      { name: "🐦 إرسال تغريدة", value: "شارك تغريدة جديدة", inline: true },
      { name: "👤 عرض حسابي", value: "اعرض ملفك الشخصي", inline: true },
    )
    .setFooter({ text: "🐦 X  •  © FTRP" });

  const menu = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder().setCustomId("select_citizen").setPlaceholder("اختر خياراً...").addOptions([
      { label: "إنشاء حساب", description: "أنشئ حسابك على Twitter X", value: "register", emoji: "📝" },
      { label: "إرسال تغريدة", description: "شارك تغريدة جديدة", value: "tweet", emoji: "🐦" },
      { label: "عرض حسابي", description: "اعرض ملفك الشخصي", value: "profile", emoji: "👤" },
    ]),
  );
  return { embed, menu };
}

function adminPanel() {
  const embed = new EmbedBuilder().setColor(0x1a2f6e)
    .setTitle("⚙️ بانل الإدارة")
    .setDescription("اختر الإجراء الذي تريد اتخاذه:")
    .addFields(
      { name: "✅ توثيق", value: "منح أو سحب علامة التوثيق", inline: true },
      { name: "⭐ نجمة", value: "منح أو سحب النجمة المميزة", inline: true },
      { name: "🚫 حظر", value: "حظر حساب من التغريد", inline: true },
      { name: "🔓 رفع حظر", value: "إلغاء حظر حساب", inline: true },
      { name: "🗑️ حذف تغريدة", value: "حذف تغريدة بمعرفها", inline: true },
      { name: "❌ حذف حساب", value: "حذف حساب نهائياً", inline: true },
      { name: "👥 زيادة متابعين", value: "إضافة متابعين لحساب", inline: true },
      { name: "➖ إزالة متابعين", value: "إزالة متابعين من حساب", inline: true },
      { name: "❤️ زيادة إعجابات", value: "إضافة إعجابات لتغريدة", inline: true },
      { name: "💔 إزالة إعجابات", value: "تخفيض إعجابات تغريدة", inline: true },
      { name: "✏️ تغيير اليوزر", value: "تغيير يوزرنيم حساب مع ذكر السبب", inline: true },
      { name: "📋 عرض الحسابات", value: "عرض جميع الحسابات المسجلة", inline: true },
      { name: "🚨 Alert", value: "إرسال تنبيه رسمي من Police Department", inline: true },
      { name: "📢 روم التغريدات", value: "تحديد الروم الذي تُنشر فيه التغريدات", inline: true },
      { name: "📋 روم اللوقات", value: "تحديد الروم الذي تُرسل فيه سجلات الإجراءات", inline: true },
    )
    .setFooter({ text: "🐦 X  •  لوحة الإدارة  •  © FTRP" });

  const menu = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder().setCustomId("select_admin").setPlaceholder("اختر إجراءً...").addOptions([
      { label: "إعطاء توثيق", description: "منح أو سحب علامة التوثيق ✅", value: "verify", emoji: "✅" },
      { label: "إعطاء نجمة", description: "منح أو سحب النجمة المميزة ⭐", value: "star", emoji: "⭐" },
      { label: "حظر حساب", description: "منع حساب من التغريد", value: "ban", emoji: "🚫" },
      { label: "رفع الحظر", description: "إلغاء حظر حساب", value: "unban", emoji: "🔓" },
      { label: "حذف تغريدة", description: "حذف تغريدة بمعرفها", value: "delete_tweet", emoji: "🗑️" },
      { label: "حذف حساب", description: "حذف حساب نهائياً", value: "delete_account", emoji: "❌" },
      { label: "زيادة متابعين", description: "إضافة متابعين لحساب", value: "add_followers", emoji: "👥" },
      { label: "إزالة متابعين", description: "إزالة متابعين من حساب", value: "remove_followers", emoji: "➖" },
      { label: "زيادة إعجابات", description: "إضافة إعجابات لتغريدة", value: "add_likes", emoji: "❤️" },
      { label: "إزالة إعجابات", description: "تخفيض إعجابات تغريدة", value: "remove_likes", emoji: "💔" },
      { label: "تغيير اليوزر", description: "تغيير اليوزر مع ذكر السبب", value: "rename_username", emoji: "✏️" },
      { label: "عرض الحسابات", description: "عرض جميع الحسابات المسجلة", value: "list_accounts", emoji: "📋" },
      { label: "Alert 🚨", description: "إرسال تنبيه رسمي من Police Department", value: "alert", emoji: "🚨" },
      { label: "روم التغريدات", description: "تحديد الروم الذي تُنشر فيه التغريدات", value: "set_tweet_channel", emoji: "📢" },
      { label: "روم اللوقات", description: "تحديد الروم الذي تُرسل فيه سجلات الإجراءات", value: "set_log_channel", emoji: "📝" },
    ]),
  );
  return { embed, menu };
}

function ok(title: string, desc: string) {
  return new EmbedBuilder().setColor(C.GREEN).setTitle(`✅ ${title}`).setDescription(desc);
}
function err(title: string, desc: string) {
  return new EmbedBuilder().setColor(C.ERROR).setTitle(`❌ ${title}`).setDescription(desc);
}
function logsEmbed(logs: Awaited<ReturnType<typeof getLogs>>) {
  const embed = new EmbedBuilder().setColor(C.PURPLE).setTitle("📋 سجل الإجراءات").setTimestamp();
  if (!logs.length) return embed.setDescription("لا توجد سجلات حتى الآن.").setFooter({ text: "لا توجد سجلات  •  © FTRP" });
  const lines = logs.map((l: any) => {
    const ts = Math.floor((l.createdAt ?? new Date()).getTime() / 1000);
    const mod = l.moderatorDiscordId ? `<@${l.moderatorDiscordId}>` : "النظام";
    const target = l.targetDiscordId ? `<@${l.targetDiscordId}>` : "—";
    return `**${l.action}** • <t:${ts}:R>\n👮 ${mod} ➜ 👤 ${target}\n> ${l.details ?? "—"}`;
  });
  return embed.setDescription(lines.join("\n\n").substring(0, 4096)).setFooter({ text: `السجلات المعروضة: ${logs.length}  •  © FTRP` });
}

// ═══════════════════════════════════════════════════════════════════
//  INTERACTION HANDLERS
// ═══════════════════════════════════════════════════════════════════

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleCommand(i: ChatInputCommandInteraction): Promise<any> {
  const sub = i.options.getSubcommand();

  if (i.commandName === "twitter") {
    if (sub === "panel") {
      const { embed, menu } = citizenPanel();
      return i.reply({ embeds: [embed], components: [menu] });
    }
  }

  if (i.commandName === "admin") {
    if (!hasAdminAccess(i))
      return i.reply({ embeds: [err("صلاحيات غير كافية", "لا تملك صلاحية الوصول لبانل الإدارة.")], ephemeral: true });

    if (sub === "panel") {
      const { embed, menu } = adminPanel();
      return i.reply({ embeds: [embed], components: [menu] });
    }
    if (sub === "logs") {
      const limit = i.options.getInteger("limit") ?? 10;
      const logs = await getLogs(i.guildId!, limit);
      return i.reply({ embeds: [logsEmbed(logs)], ephemeral: true });
    }
  }
  return;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleSelectMenu(i: StringSelectMenuInteraction): Promise<any> {
  const v = i.values[0]!;

  if (i.customId === "select_citizen") {
    if (v === "register") {
      const existing = await getAccount(i.user.id, i.guildId!);
      if (existing) return i.reply({ embeds: [err("لديك حساب بالفعل", `حسابك: **${existing.displayName}** (@${existing.username})`)], ephemeral: true });
      const modal = new ModalBuilder().setCustomId("modal_register").setTitle("📝 إنشاء حساب Twitter X");
      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("username").setLabel("اسم المستخدم (بدون @)").setStyle(TextInputStyle.Short).setPlaceholder("مثال: ahmed2024").setMinLength(3).setMaxLength(20).setRequired(true),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("display_name").setLabel("الاسم الظاهر").setStyle(TextInputStyle.Short).setPlaceholder("مثال: M7md ").setMaxLength(30).setRequired(true),
        ),
      );
      return i.showModal(modal);
    }

    if (v === "tweet") {
      const account = await getAccount(i.user.id, i.guildId!);
      if (!account) return i.reply({ embeds: [err("لا يوجد حساب", "أنشئ حساباً أولاً.")], ephemeral: true });
      if (account.banned) return i.reply({ embeds: [err("حساب محظور", "تم حظر حسابك.")], ephemeral: true });
      const modal = new ModalBuilder().setCustomId("modal_tweet").setTitle("🐦 إرسال تغريدة");
      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("content").setLabel("محتوى التغريدة").setStyle(TextInputStyle.Paragraph).setPlaceholder("اكتب تغريدتك هنا...").setMaxLength(280).setRequired(true),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("image_url").setLabel("رابط الصورة (اختياري)").setStyle(TextInputStyle.Short).setPlaceholder("https://example.com/image.png").setRequired(false),
        ),
      );
      return i.showModal(modal);
    }

    if (v === "profile") {
      const account = await getAccount(i.user.id, i.guildId!);
      if (!account) return i.reply({ embeds: [err("لا يوجد حساب", "أنشئ حساباً أولاً.")], ephemeral: true });
      const [f, t] = await Promise.all([getFollowersCount(account.id), getTweetCount(account.id)]);
      return i.reply({ embeds: [profileEmbed(account, f, t)], ephemeral: true });
    }
  }

  if (i.customId === "select_admin") {
    if (!hasAdminAccess(i))
      return i.reply({ embeds: [err("صلاحيات غير كافية", "لا تملك صلاحية الوصول لبانل الإدارة.")], ephemeral: true });

    const single = (id: string, title: string) => {
      const m = new ModalBuilder().setCustomId(id).setTitle(title);
      m.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("target").setLabel("اسم المستخدم (@username) أو ID الديسكورد").setStyle(TextInputStyle.Short).setRequired(true),
      ));
      return m;
    };

    if (v === "verify") return i.showModal(single("modal_verify", "✅ إعطاء / سحب التوثيق"));
    if (v === "star") return i.showModal(single("modal_star", "⭐ إعطاء / سحب النجمة"));
    if (v === "unban") return i.showModal(single("modal_unban", "🔓 رفع الحظر"));
    if (v === "delete_account") return i.showModal(single("modal_delete_account", "❌ حذف حساب"));

    if (v === "ban") {
      const m = new ModalBuilder().setCustomId("modal_ban").setTitle("🚫 حظر حساب");
      m.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("target").setLabel("اسم المستخدم أو ID الديسكورد").setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("reason").setLabel("سبب الحظر (اختياري)").setStyle(TextInputStyle.Short).setRequired(false)),
      );
      return i.showModal(m);
    }
    if (v === "delete_tweet") {
      const m = new ModalBuilder().setCustomId("modal_delete_tweet").setTitle("🗑️ حذف تغريدة");
      m.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("tweet_id").setLabel("معرف التغريدة (#ID)").setStyle(TextInputStyle.Short).setRequired(true)));
      return i.showModal(m);
    }
    if (v === "add_followers") {
      const m = new ModalBuilder().setCustomId("modal_add_followers").setTitle("👥 زيادة متابعين");
      m.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("target").setLabel("اسم المستخدم أو ID الديسكورد").setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("amount").setLabel("عدد المتابعين").setStyle(TextInputStyle.Short).setPlaceholder("مثال: 100").setRequired(true)),
      );
      return i.showModal(m);
    }
    if (v === "add_likes") {
      const m = new ModalBuilder().setCustomId("modal_add_likes").setTitle("❤️ زيادة إعجابات");
      m.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("tweet_id").setLabel("معرف التغريدة (#ID)").setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("amount").setLabel("عدد الإعجابات").setStyle(TextInputStyle.Short).setPlaceholder("مثال: 50").setRequired(true)),
      );
      return i.showModal(m);
    }
    if (v === "rename_username") {
      const m = new ModalBuilder().setCustomId("modal_rename_username").setTitle("✏️ تغيير اليوزر");
      m.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("old_username").setLabel("اسم المستخدم الحالي (أو ID الديسكورد)").setStyle(TextInputStyle.Short).setPlaceholder("مثال: ahmed2024").setRequired(true),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("new_username").setLabel("اسم المستخدم الجديد").setStyle(TextInputStyle.Short).setPlaceholder("3-20 حرفاً بدون مسافات أو رموز").setMinLength(3).setMaxLength(20).setRequired(true),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("reason").setLabel("سبب التغيير").setStyle(TextInputStyle.Paragraph).setPlaceholder("اكتب سبب تغيير الاسم هنا...").setMaxLength(200).setRequired(true),
        ),
      );
      return i.showModal(m);
    }
    if (v === "remove_followers") {
      const m = new ModalBuilder().setCustomId("modal_remove_followers").setTitle("➖ إزالة متابعين");
      m.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("target").setLabel("اسم المستخدم أو ID الديسكورد").setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("amount").setLabel("عدد المتابعين المراد إزالتهم").setStyle(TextInputStyle.Short).setPlaceholder("مثال: 100").setRequired(true)),
      );
      return i.showModal(m);
    }
    if (v === "remove_likes") {
      const m = new ModalBuilder().setCustomId("modal_remove_likes").setTitle("💔 إزالة إعجابات");
      m.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("tweet_id").setLabel("معرف التغريدة (#ID)").setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("amount").setLabel("عدد الإعجابات المراد إزالتها").setStyle(TextInputStyle.Short).setPlaceholder("مثال: 50").setRequired(true)),
      );
      return i.showModal(m);
    }
    if (v === "list_accounts") {
      await i.deferReply({ ephemeral: true });
      const accounts = await getAllAccounts(i.guildId!);
      if (!accounts.length) return i.editReply({ embeds: [err("لا توجد حسابات", "لم يُسجَّل أي حساب بعد.")] });
      const lines = accounts.slice(0, 25).map((a: any, idx: number) => {
        const status = a.banned ? "🚫" : "✅";
        const badges = `${a.verified ? "✅" : ""}${a.starred ? "⭐" : ""}`;
        return `**${idx + 1}.** ${badges} **${a.displayName}** (@${a.username}) ${status} — <@${a.discordUserId}>`;
      });
      const embed = new EmbedBuilder().setColor(C.PURPLE)
        .setTitle(`📋 جميع الحسابات (${accounts.length})`)
        .setDescription(lines.join("\n"))
        .setFooter({ text: `🐦 X  •  © FTRP` })
        .setTimestamp();
      return i.editReply({ embeds: [embed] });
    }
    if (v === "alert") {
      const m = new ModalBuilder().setCustomId("modal_alert").setTitle("🚨 إرسال Alert");
      m.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("message").setLabel("نص التنبيه").setStyle(TextInputStyle.Paragraph).setPlaceholder("اكتب رسالة التنبيه هنا...").setMaxLength(1000).setRequired(true),
        ),
      );
      return i.showModal(m);
    }
    if (v === "set_tweet_channel") {
      const m = new ModalBuilder().setCustomId("modal_set_tweet_channel").setTitle("📢 تحديد روم التغريدات");
      m.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("channel_id").setLabel("ID الروم").setStyle(TextInputStyle.Short).setPlaceholder("مثال: 1234567890123456789").setRequired(true),
        ),
      );
      return i.showModal(m);
    }
    if (v === "set_log_channel") {
      const m = new ModalBuilder().setCustomId("modal_set_log_channel").setTitle("📋 تحديد روم اللوقات");
      m.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("channel_id").setLabel("ID الروم").setStyle(TextInputStyle.Short).setPlaceholder("مثال: 1234567890123456789").setRequired(true),
        ),
      );
      return i.showModal(m);
    }
  }
  return;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleModal(i: ModalSubmitInteraction): Promise<any> {
  const { customId } = i;

  if (customId === "modal_register") {
    const username = i.fields.getTextInputValue("username").replace("@", "").trim();
    const displayName = i.fields.getTextInputValue("display_name").trim();
    if (!/^[\w\u0600-\u06FF]{3,20}$/.test(username))
      return i.reply({ embeds: [err("اسم مستخدم غير صالح", "3-20 حرفاً بدون مسافات أو رموز خاصة.")], ephemeral: true });
    if (await getAccountByUsername(username, i.guildId!))
      return i.reply({ embeds: [err("الاسم محجوز", `@${username} مستخدم. اختر اسماً آخر.`)], ephemeral: true });
    const avatarUrl = i.user.displayAvatarURL({ size: 128 });
    await createAccount(i.user.id, i.guildId!, username, displayName, avatarUrl);
    await addLog(i.guildId!, "إنشاء حساب", i.user.id, null, `@${username} — ${displayName}`);
    return i.reply({ embeds: [ok("تم إنشاء حسابك! 🎉", `**الاسم الظاهر:** ${displayName}\n**اسم المستخدم:** @${username}\n\nيمكنك الآن البدء بالتغريد!`)], ephemeral: true });
  }

  if (customId === "modal_tweet") {
    await i.deferReply({ ephemeral: true });
    const content = i.fields.getTextInputValue("content").trim();
    const imageUrl = (() => { try { const v = i.fields.getTextInputValue("image_url").trim(); return v || undefined; } catch { return undefined; } })();
    const account = await getAccount(i.user.id, i.guildId!);
    if (!account || account.banned) return i.editReply({ embeds: [err("خطأ", account?.banned ? "حسابك محظور." : "لا يوجد حساب.")] });
    const settings = await getSettings(i.guildId!);
    if (!settings?.tweetChannelId) return i.editReply({ embeds: [err("لم يتم الإعداد", "اطلب من الأدمن تشغيل `/twitter setup`.")] });
    await updateAvatar(account.id, i.user.displayAvatarURL({ size: 128 }));
    account.avatarUrl = i.user.displayAvatarURL({ size: 128 });
    const tweet = await createTweet(account.id, i.guildId!, content, imageUrl);
    const followers = await getFollowersCount(account.id);
    try {
      const ch = await i.client.channels.fetch(settings.tweetChannelId) as TextChannel;
      const msg = await ch.send({ embeds: [tweetEmbed(tweet, account, followers, 0)], components: [tweetButtons(tweet.id, account.id, 0)] });
      await updateTweetMessage(tweet.id, msg.id, ch.id);
    } catch {
      await deleteTweet(tweet.id);
      return i.editReply({ embeds: [err("خطأ في الإرسال", "تأكد من أن للبوت صلاحية الإرسال في الروم.")] });
    }
    await addLog(i.guildId!, "تغريدة جديدة", i.user.id, null, `#${tweet.id}: ${content.substring(0, 60)}`);
    return i.editReply({ embeds: [ok("تم إرسال التغريدة! 🐦", "تم إرسال تغريدتك بنجاح.")] });
  }

  if (customId.startsWith("modal_comment")) {
    await i.deferReply({ ephemeral: true });
    const parts = customId.split("_");
    const tweetIdStr = parts[2] === "0" ? i.fields.getTextInputValue("tweet_id") : parts[2]!;
    const tweetId = parseInt(tweetIdStr, 10);
    const content = i.fields.getTextInputValue("content").trim();
    const account = await getAccount(i.user.id, i.guildId!);
    if (!account || account.banned) return i.editReply({ embeds: [err("خطأ", account?.banned ? "حسابك محظور." : "لا يوجد حساب.")] });

    const tweet = await getTweet(tweetId);
    if (!tweet || !tweet.messageId || !tweet.channelId) return i.editReply({ embeds: [err("خطأ", "التغريدة غير موجودة أو لا يمكن التعليق عليها.")] });

    // التحقق من تعليق واحد فقط
    const existingComment = await Comment.findOne({ authorId: account.id, tweetId });
    if (existingComment) return i.editReply({ embeds: [err("خطأ", "لا يمكنك التعليق على التغريدة أكثر من مرة.")] });

    const comment = await createComment(tweetId, account.id, content);

    try {
      const tweetCh = await i.client.channels.fetch(tweet.channelId) as TextChannel;
      const originalMsg = await tweetCh.messages.fetch(tweet.messageId);

      // إنشاء ثريد أو جلب الثريد الموجود
      let thread = originalMsg.thread;
      if (!thread) {
        thread = await originalMsg.startThread({
          name: `تعليقات التغريدة #${tweetId}`,
          autoArchiveDuration: 1440,
        });
        // منع الأعضاء من الكتابة في الثريد (باستثناء البوت)
        await (thread as any).permissionOverwrites?.edit(i.guildId!, { SendMessages: false });
      }

      // إرسال التعليق داخل الثريد
      await thread.send({ embeds: [commentEmbed(comment, account, tweetId)] });

      // تحديث عداد التعليقات في الرسالة الأصلية
      const [f, c] = await Promise.all([getFollowersCount(account.id), getCommentsCount(tweetId)]);
      await originalMsg.edit({ embeds: [tweetEmbed(tweet, account, f, c)], components: [tweetButtons(tweetId, tweet.authorId!, tweet.likeCount ?? 0)] });

    } catch (e) {
      console.error(e);
      return i.editReply({ embeds: [err("خطأ", "فشل إنشاء الثريد أو إرسال التعليق.")] });
    }

    return i.editReply({ embeds: [ok("تم إرسال التعليق! 💬", "تم إضافة تعليقك داخل ثريد التغريدة.")] });
  }

  if (customId === "modal_verify") {
    await i.deferReply({ ephemeral: true });
    const target = await resolveTarget(i.fields.getTextInputValue("target"), i.guildId!);
    if (!target) return i.editReply({ embeds: [err("حساب غير موجود", "لم يتم العثور على الحساب.")] });
    await verifyAccount(target.id, !target.verified);
    const action = target.verified ? "إزالة التوثيق" : "منح التوثيق";
    await addLog(i.guildId!, action, target.discordUserId, i.user.id, `@${target.username}`);
    return i.editReply({ embeds: [ok("تم!", `${action} لـ **${target.displayName}** (@${target.username}).`)] });
  }

  if (customId === "modal_star") {
    await i.deferReply({ ephemeral: true });
    const target = await resolveTarget(i.fields.getTextInputValue("target"), i.guildId!);
    if (!target) return i.editReply({ embeds: [err("حساب غير موجود", "لم يتم العثور على الحساب.")] });
    await starAccount(target.id, !target.starred);
    const action = target.starred ? "إزالة النجمة" : "منح النجمة";
    await addLog(i.guildId!, action, target.discordUserId, i.user.id, `@${target.username}`);
    return i.editReply({ embeds: [ok("تم!", `${action} لـ **${target.displayName}** (@${target.username}).`)] });
  }

  if (customId === "modal_ban") {
    await i.deferReply({ ephemeral: true });
    const reason = (() => { try { return i.fields.getTextInputValue("reason") || "لم يحدد"; } catch { return "لم يحدد"; } })();
    const target = await resolveTarget(i.fields.getTextInputValue("target"), i.guildId!);
    if (!target) return i.editReply({ embeds: [err("حساب غير موجود", "لم يتم العثور على الحساب.")] });
    await banAccount(target.id, true);
    await addLog(i.guildId!, "حظر حساب", target.discordUserId, i.user.id, `@${target.username} — ${reason}`);
    return i.editReply({ embeds: [ok("تم الحظر!", `تم حظر **${target.displayName}**.\n**السبب:** ${reason}`)] });
  }

  if (customId === "modal_unban") {
    await i.deferReply({ ephemeral: true });
    const target = await resolveTarget(i.fields.getTextInputValue("target"), i.guildId!);
    if (!target) return i.editReply({ embeds: [err("حساب غير موجود", "لم يتم العثور على الحساب.")] });
    await banAccount(target.id, false);
    await addLog(i.guildId!, "رفع حظر", target.discordUserId, i.user.id, `@${target.username}`);
    return i.editReply({ embeds: [ok("تم رفع الحظر!", `رُفع الحظر عن **${target.displayName}** (@${target.username}).`)] });
  }

  if (customId === "modal_delete_tweet") {
    await i.deferReply({ ephemeral: true });
    const tweetId = parseInt(i.fields.getTextInputValue("tweet_id"), 10);
    const tweet = await getTweet(tweetId);
    if (!tweet) return i.editReply({ embeds: [err("تغريدة غير موجودة", `لا توجد تغريدة #${tweetId}.`)] });
    if (tweet.messageId && tweet.channelId) {
      try { const ch = await i.client.channels.fetch(tweet.channelId) as TextChannel; await (await ch.messages.fetch(tweet.messageId)).delete(); } catch { /* ignore */ }
    }
    await deleteTweet(tweetId);
    await addLog(i.guildId!, "حذف تغريدة", null, i.user.id, `#${tweetId}`);
    return i.editReply({ embeds: [ok("تم الحذف!", `تم حذف التغريدة #${tweetId}.`)] });
  }

  if (customId === "modal_delete_account") {
    await i.deferReply({ ephemeral: true });
    const target = await resolveTarget(i.fields.getTextInputValue("target"), i.guildId!);
    if (!target) return i.editReply({ embeds: [err("حساب غير موجود", "لم يتم العثور على الحساب.")] });
    await addLog(i.guildId!, "حذف حساب", target.discordUserId, i.user.id, `@${target.username}`);
    await deleteAccount(target.id);
    return i.editReply({ embeds: [ok("تم الحذف!", `حُذف حساب **${target.displayName}** نهائياً.`)] });
  }

  if (customId === "modal_add_followers") {
    await i.deferReply({ ephemeral: true });
    const amount = parseInt(i.fields.getTextInputValue("amount"), 10);
    if (isNaN(amount) || amount <= 0) return i.editReply({ embeds: [err("قيمة غير صالحة", "أدخل رقماً موجباً.")] });
    const target = await resolveTarget(i.fields.getTextInputValue("target"), i.guildId!);
    if (!target) return i.editReply({ embeds: [err("حساب غير موجود", "لم يتم العثور على الحساب.")] });
    await addBonusFollowers(target.id, amount);
    await addLog(i.guildId!, "زيادة متابعين", target.discordUserId, i.user.id, `+${amount} لـ @${target.username}`);
    return i.editReply({ embeds: [ok("تمت الإضافة!", `تمت إضافة **${amount.toLocaleString()}** متابع لـ **${target.displayName}**.`)] });
  }

  if (customId === "modal_add_likes") {
    await i.deferReply({ ephemeral: true });
    const tweetId = parseInt(i.fields.getTextInputValue("tweet_id"), 10);
    const amount = parseInt(i.fields.getTextInputValue("amount"), 10);
    if (isNaN(amount) || amount <= 0) return i.editReply({ embeds: [err("قيمة غير صالحة", "أدخل رقماً موجباً.")] });
    const tweet = await getTweet(tweetId);
    if (!tweet) return i.editReply({ embeds: [err("تغريدة غير موجودة", `لا توجد تغريدة #${tweetId}.`)] });
    await addBonusLikes(tweetId, amount);
    await addLog(i.guildId!, "زيادة إعجابات", null, i.user.id, `+${amount} للتغريدة #${tweetId}`);
    const updated = await getTweet(tweetId);
    if (updated && tweet.messageId && tweet.channelId) {
      try {
        const ch = await i.client.channels.fetch(tweet.channelId) as TextChannel;
        const msg = await ch.messages.fetch(tweet.messageId);
        const author = await getAccountById(tweet.authorId!);
        if (author) {
          const [f, c] = await Promise.all([getFollowersCount(author.id), getCommentsCount(tweetId)]);
          await msg.edit({ embeds: [tweetEmbed(updated, author, f, c)], components: [tweetButtons(tweetId, author.id, updated.likeCount ?? 0)] });
        }
      } catch { /* ignore */ }
    }
    return i.editReply({ embeds: [ok("تمت الإضافة!", `تمت إضافة **${amount.toLocaleString()}** إعجاب للتغريدة #${tweetId}.`)] });
  }

  if (customId === "modal_remove_followers") {
    await i.deferReply({ ephemeral: true });
    const amount = parseInt(i.fields.getTextInputValue("amount"), 10);
    if (isNaN(amount) || amount <= 0) return i.editReply({ embeds: [err("قيمة غير صالحة", "أدخل رقماً موجباً.")] });
    const target = await resolveTarget(i.fields.getTextInputValue("target"), i.guildId!);
    if (!target) return i.editReply({ embeds: [err("حساب غير موجود", "لم يتم العثور على الحساب.")] });
    await removeBonusFollowers(target.id, amount);
    await addLog(i.guildId!, "إزالة متابعين", target.discordUserId, i.user.id, `-${amount} من @${target.username}`);
    return i.editReply({ embeds: [ok("تمت الإزالة!", `تمت إزالة **${amount.toLocaleString()}** متابع من **${target.displayName}**.`)] });
  }

  if (customId === "modal_remove_likes") {
    await i.deferReply({ ephemeral: true });
    const tweetId = parseInt(i.fields.getTextInputValue("tweet_id"), 10);
    const amount = parseInt(i.fields.getTextInputValue("amount"), 10);
    if (isNaN(amount) || amount <= 0) return i.editReply({ embeds: [err("قيمة غير صالحة", "أدخل رقماً موجباً.")] });
    const tweet = await getTweet(tweetId);
    if (!tweet) return i.editReply({ embeds: [err("تغريدة غير موجودة", `لا توجد تغريدة #${tweetId}.`)] });
    await removeBonusLikes(tweetId, amount);
    await addLog(i.guildId!, "إزالة إعجابات", null, i.user.id, `-${amount} من التغريدة #${tweetId}`);
    const updated = await getTweet(tweetId);
    if (updated && tweet.messageId && tweet.channelId) {
      try {
        const ch = await i.client.channels.fetch(tweet.channelId) as TextChannel;
        const msg = await ch.messages.fetch(tweet.messageId);
        const author = await getAccountById(tweet.authorId!);
        if (author) {
          const [f, c] = await Promise.all([getFollowersCount(author.id), getCommentsCount(tweetId)]);
          await msg.edit({ embeds: [tweetEmbed(updated, author, f, c)], components: [tweetButtons(tweetId, author.id, updated.likeCount ?? 0)] });
        }
      } catch { /* ignore */ }
    }
    return i.editReply({ embeds: [ok("تمت الإزالة!", `تمت إزالة **${amount.toLocaleString()}** إعجاب من التغريدة #${tweetId}.`)] });
  }

  if (customId === "modal_alert") {
    await i.deferReply({ ephemeral: true });
    const message = i.fields.getTextInputValue("message").trim();
    const settings = await getSettings(i.guildId!);
    if (!settings?.tweetChannelId) return i.editReply({ embeds: [err("لم يتم الإعداد", "حدد روم التغريدات أولاً من بانل الأدمن.")] });
    try {
      const ch = await i.client.channels.fetch(settings.tweetChannelId) as TextChannel;
      const alertEmbed = new EmbedBuilder().setColor(POLICE_COLOR)
        .setAuthor({ name: "Police Department 🚔", iconURL: POLICE_AVATAR })
        .setTitle("🚨 تنبيه رسمي")
        .setDescription(message)
        .setImage(POLICE_AVATAR)
        .setFooter({ text: "🐦 X  •  Police Department  •  © FTRP" })
        .setTimestamp();
      await ch.send({ content: "@everyone", embeds: [alertEmbed] });
      await addLog(i.guildId!, "Alert", null, i.user.id, message.substring(0, 80));
      return i.editReply({ embeds: [ok("تم إرسال التنبيه! 🚨", "تم إرسال تنبيه Police Department بنجاح.")] });
    } catch {
      return i.editReply({ embeds: [err("خطأ في الإرسال", "تأكد من أن للبوت صلاحية الإرسال في الروم.")] });
    }
  }

  if (customId === "modal_set_tweet_channel") {
    await i.deferReply({ ephemeral: true });
    const channelId = i.fields.getTextInputValue("channel_id").trim();
    try {
      const ch = await i.client.channels.fetch(channelId) as TextChannel;
      await setTweetChannel(i.guildId!, ch.id);
      await addLog(i.guildId!, "إعداد روم التغريدات", null, i.user.id, `→ <#${ch.id}>`);
      return i.editReply({ embeds: [ok("تم الإعداد ✅", `سيتم إرسال التغريدات إلى <#${ch.id}>.`)] });
    } catch {
      return i.editReply({ embeds: [err("روم غير صالح", "تأكد أن الـ ID صحيح وأن للبوت صلاحية الوصول للروم.")] });
    }
  }

  if (customId === "modal_set_log_channel") {
    await i.deferReply({ ephemeral: true });
    const channelId = i.fields.getTextInputValue("channel_id").trim();
    try {
      const ch = await i.client.channels.fetch(channelId) as TextChannel;
      await setLogChannel(i.guildId!, ch.id);
      await addLog(i.guildId!, "إعداد روم اللوقات", null, i.user.id, `→ <#${ch.id}>`);
      return i.editReply({ embeds: [ok("تم الإعداد ✅", `سيتم إرسال سجلات الإجراءات إلى <#${ch.id}>.`)] });
    } catch {
      return i.editReply({ embeds: [err("روم غير صالح", "تأكد أن الـ ID صحيح وأن للبوت صلاحية الوصول للروم.")] });
    }
  }

  if (customId === "modal_rename_username") {
    await i.deferReply({ ephemeral: true });
    const oldInput = i.fields.getTextInputValue("old_username").trim();
    const newUsername = i.fields.getTextInputValue("new_username").trim().toLowerCase();
    const reason = i.fields.getTextInputValue("reason").trim();
    if (!/^[\w\u0600-\u06FF]{3,20}$/.test(newUsername))
      return i.editReply({ embeds: [err("اسم غير صالح", "3-20 حرفاً بدون مسافات أو رموز خاصة.")] });
    const target = await resolveTarget(oldInput, i.guildId!);
    if (!target) return i.editReply({ embeds: [err("حساب غير موجود", "لم يتم العثور على الحساب بهذا الاسم أو الـ ID.")] });
    const existing = await getAccountByUsername(newUsername, i.guildId!);
    if (existing && existing.id !== target.id)
      return i.editReply({ embeds: [err("الاسم محجوز", `@${newUsername} مستخدم بالفعل. اختر اسماً آخر.`)] });
    const oldUsername = target.username;
    await changeUsername(target.id, newUsername);
    await addLog(i.guildId!, "تغيير اسم المستخدم", target.discordUserId, i.user.id, `@${oldUsername} → @${newUsername} | السبب: ${reason}`);
    return i.editReply({
      embeds: [ok("تم التغيير! ✏️",
        `**الاسم القديم:** @${oldUsername}\n**الاسم الجديد:** @${newUsername}\n**السبب:** ${reason}`
      )]
    });
  }

  return;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleButton(i: ButtonInteraction): Promise<any> {
  const { customId } = i;

  if (customId.startsWith("like_")) {
    await i.deferReply({ ephemeral: true });
    const tweetId = parseInt(customId.replace("like_", ""), 10);
    const account = await getAccount(i.user.id, i.guildId!);
    if (!account) return i.editReply({ embeds: [err("لا يوجد حساب", "أنشئ حساباً عبر `/twitter panel`.")] });
    if (account.banned) return i.editReply({ embeds: [err("حساب محظور", "لا يمكنك التفاعل.")] });
    const tweet = await getTweet(tweetId);
    if (!tweet) return i.editReply({ embeds: [err("تغريدة غير موجودة", "هذه التغريدة غير موجودة.")] });
    const liked = await toggleLike(account.id, tweetId);
    const updated = await getTweet(tweetId);
    const author = await getAccountById(tweet.authorId!);
    if (updated && author && tweet.messageId && tweet.channelId) {
      try {
        const ch = await i.client.channels.fetch(tweet.channelId) as TextChannel;
        const msg = await ch.messages.fetch(tweet.messageId);
        const [f, c] = await Promise.all([getFollowersCount(author.id), getCommentsCount(tweetId)]);
        await msg.edit({ embeds: [tweetEmbed(updated, author, f, c)], components: [tweetButtons(tweetId, author.id, updated.likeCount ?? 0)] });
      } catch { /* ignore */ }
    }
    return i.editReply({ embeds: [liked ? ok("إعجاب! ❤️", `أعجبت بالتغريدة #${tweetId}.`) : ok("تم الإلغاء", `ألغيت إعجابك بالتغريدة #${tweetId}.`)] });
  }

  if (customId.startsWith("follow_")) {
    await i.deferReply({ ephemeral: true });
    const targetId = parseInt(customId.replace("follow_", ""), 10);
    const me = await getAccount(i.user.id, i.guildId!);
    if (!me) return i.editReply({ embeds: [err("لا يوجد حساب", "أنشئ حساباً عبر `/twitter panel`.")] });
    if (me.banned) return i.editReply({ embeds: [err("حساب محظور", "لا يمكنك المتابعة.")] });
    const target = await getAccountById(targetId);
    if (!target) return i.editReply({ embeds: [err("حساب غير موجود", "هذا الحساب غير موجود.")] });
    if (me.id === targetId) return i.editReply({ embeds: [err("خطأ", "لا يمكنك متابعة نفسك!")] });
    const followed = await toggleFollow(me.id, targetId);
    return i.editReply({ embeds: [followed ? ok("متابعة! 👥", `بدأت متابعة **${target.displayName}** (@${target.username}).`) : ok("إلغاء المتابعة", `ألغيت متابعة **${target.displayName}**.`)] });
  }

  if (customId.startsWith("comment_")) {
    const tweetId = customId.replace("comment_", "");
    const account = await getAccount(i.user.id, i.guildId!);
    if (!account) return i.reply({ embeds: [err("لا يوجد حساب", "أنشئ حساباً عبر `/twitter panel`.")], ephemeral: true });
    if (account.banned) return i.reply({ embeds: [err("حساب محظور", "لا يمكنك التعليق.")], ephemeral: true });
    const modal = new ModalBuilder().setCustomId(`modal_comment_${tweetId}`).setTitle(`💬 تعليق على #${tweetId}`);
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("content").setLabel("التعليق").setStyle(TextInputStyle.Paragraph).setPlaceholder("اكتب تعليقك هنا...").setMaxLength(280).setRequired(true),
      ),
    );
    return i.showModal(modal);
  }
  return;
}

async function handleInteraction(interaction: Interaction) {
  try {
    if (interaction.isChatInputCommand()) await handleCommand(interaction);
    else if (interaction.isStringSelectMenu()) await handleSelectMenu(interaction);
    else if (interaction.isModalSubmit()) await handleModal(interaction);
    else if (interaction.isButton()) await handleButton(interaction);
  } catch (e) {
    console.error("Interaction error:", e);
    const payload = { embeds: [err("خطأ", "حدث خطأ غير متوقع.")], ephemeral: true } as const;
    try {
      if (interaction.isRepliable()) {
        if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
        else await interaction.reply(payload);
      }
    } catch { /* ignore */ }
  }
}

export async function startBot(): Promise<void> {
  const token = process.env["DISCORD_TOKEN"];
  if (!token) {
    console.warn("DISCORD_TOKEN not set — Discord bot will not start.");
    return;
  }

  // تسجيل الأوامر تلقائياً
  const clientId = process.env["DISCORD_CLIENT_ID"];
  if (clientId) {
    const rest = new REST().setToken(token);
    await rest.put(Routes.applicationCommands(clientId), { body: getCommands() });
    console.log("Slash commands registered globally.");
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  botClient = client;

  client.once("ready", () => {
    console.log(`Bot online: ${client.user?.tag}`);
    client.user?.setPresence({
      status: PresenceUpdateStatus.Online,
      activities: [{ name: "Powered By FTRP .", type: ActivityType.Playing }],
    });
  });

  client.on("interactionCreate", handleInteraction);
  client.on("error", (e) => console.error("Discord client error:", e));
  await client.login(token);
}

// ═══════════════════════════════════════════════════════════════════
//  ENTRY POINT
// ═══════════════════════════════════════════════════════════════════

async function main() {
  const mongoUri = process.env["MONGODB_URI"];
  if (!mongoUri) throw new Error("MONGODB_URI environment variable is required");

  await mongoose.connect(mongoUri);
  console.log("MongoDB connected");

  // HTTP health check — مطلوب لـ Render
  const port = parseInt(process.env["PORT"] ?? "3000", 10);
  http.createServer((_, res) => { res.writeHead(200); res.end("OK"); }).listen(port, () => {
    console.log(`Health check listening on port ${port}`);
  });

  // Keep-alive — يبعث ping كل 14 دقيقة لمنع النوم
  const selfUrl = process.env["RENDER_URL"];
  if (selfUrl) {
    const ping = selfUrl.startsWith("https") ? require("https") : require("http");
    setInterval(() => {
      ping.get(selfUrl, (res: any) => {
        console.log(`Keep-alive ping → ${res.statusCode}`);
      }).on("error", (e: any) => {
        console.warn(`Keep-alive ping failed: ${e.message}`);
      });
    }, 14 * 60 * 1000);
    console.log(`Keep-alive enabled → ${selfUrl}`);
  }

  await startBot();
}

main().catch((e) => { console.error("Fatal error:", e); process.exit(1); });
