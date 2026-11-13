export const PLATFORMS = {
  telegram: { label: "Telegram", domains: ["t.me", "telegram.me", "telegram.dog", "telegram.org"] },
  github: { label: "GitHub", domains: ["github.com", "github.io", "gist.github.com"] },
  instagram: { label: "Instagram", domains: ["instagram.com", "instagr.am"] },
  discord: { label: "Discord", domains: ["discord.com", "discord.gg", "discordapp.com"] },
  tiktok: { label: "TikTok", domains: ["tiktok.com"] },
  youtube: { label: "YouTube", domains: ["youtube.com", "youtu.be"] },
  facebook: { label: "Facebook", domains: ["facebook.com", "fb.com", "fb.me"] },
  x: { label: "X / Twitter", domains: ["x.com", "twitter.com", "t.co"] },
  vk: { label: "VK", domains: ["vk.com", "vk.ru", "vkontakte.ru"] },
  whatsapp: { label: "WhatsApp", domains: ["whatsapp.com", "wa.me"] },
  signal: { label: "Signal", domains: ["signal.org", "signal.me", "signal.group"] },
  reddit: { label: "Reddit", domains: ["reddit.com", "redd.it"] },
  twitch: { label: "Twitch", domains: ["twitch.tv"] },
  steam: { label: "Steam", domains: ["steamcommunity.com", "steampowered.com"] },
  bluesky: { label: "Bluesky", domains: ["bsky.app", "bsky.social"] },
  threads: { label: "Threads", domains: ["threads.com", "threads.net"] },
  viber: { label: "Viber", domains: ["viber.com"] },
  pinterest: { label: "Pinterest", domains: ["pinterest.com", "pin.it"] },
  snapchat: { label: "Snapchat", domains: ["snapchat.com"] },
  mastodon: { label: "Mastodon", domains: ["mastodon.social", "mastodon.online", "mstdn.social"] },
  gitlab: { label: "GitLab", domains: ["gitlab.com", "gitlab.io"] },
  spotify: { label: "Spotify", domains: ["spotify.com", "spotify.link"] },
};

export function supportsPlatform(type) {
  return type === "account" || type === "link";
}

export function platformLink(value) {
  const address = typeof value === "string" ? value.trim() : "";
  if (!address || /[\s\\]/.test(address)) return null;
  try {
    const url = new URL(address.includes("://") ? address : `https://${address}`);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    const host = url.hostname.replace(/\.$/, "");
    const match = Object.entries(PLATFORMS).find(([, { domains }]) =>
      domains.some(domain => host === domain || host.endsWith(`.${domain}`)));
    return match ? { platform: match[0], href: url.href } : null;
  } catch {
    return null;
  }
}

export function nodePlatform({ type, value, source, platform }) {
  if (!supportsPlatform(type)) return "";
  if (typeof platform === "string" && Object.hasOwn(PLATFORMS, platform)) return platform;
  const link = platformLink(value) ?? (type === "account" ? platformLink(source) : null);
  return link?.platform ?? "";
}
