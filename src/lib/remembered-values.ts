// Lightweight localStorage-backed "remember my last input" for form fields
// that are usually the same across submissions (referrer, channel). Purely a
// UX convenience — never required, always editable/clearable by the user.
export const LAST_REFERRER_KEY = "careerplatform:lastReferrer";
export const LAST_SOURCE_KEY = "careerplatform:lastSource";

export function recallValue(key: string): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

export function rememberValue(key: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    if (value) {
      window.localStorage.setItem(key, value);
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // localStorage can throw in private-browsing/quota-exceeded edge cases;
    // this is a pure convenience feature, so just skip remembering silently
  }
}
