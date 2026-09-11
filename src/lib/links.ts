// The two outward-facing contact points, defined once so the nav, the footer
// and any future screen agree. Change them here, not in the components.

/** Public help centre: the Notion page "27 · Visu Help — user guide". The page
 *  is private until the founder clicks Publish in Notion; until then this link
 *  shows a Notion sign-in to visitors. Swap in the notion.site URL once
 *  published if Notion issues a different public address. */
export const HELP_URL = "https://www.notion.so/3d85439598aa81918983ecaa0cddd25d";

/** Support inbox shown in the footer. visuail.life had no mail routing (no MX
 *  records) on 2026-09-11 -- set up forwarding for this address, or change it,
 *  before launch. */
export const SUPPORT_EMAIL = "support@visuail.life";
