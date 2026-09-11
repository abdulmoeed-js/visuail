// The two outward-facing contact points, defined once so the nav, the footer
// and any future screen agree. Change them here, not in the components.

/** Public help centre: the Notion page "Visu Help", served on the workspace's
 *  public domain. Notion only serves published pages on notion.site; the
 *  notion.so address keeps a sign-in wall for anonymous visitors even after
 *  publishing. Shows "page couldn't be found" until the founder publishes the
 *  page (Share -> Publish) in Notion. */
export const HELP_URL = "https://abdulmoeeeed.notion.site/3d85439598aa81918983ecaa0cddd25d";

/** Support inbox shown in the footer. visuail.life had no mail routing (no MX
 *  records) on 2026-09-11 -- set up forwarding for this address, or change it,
 *  before launch. */
export const SUPPORT_EMAIL = "support@visuail.life";
