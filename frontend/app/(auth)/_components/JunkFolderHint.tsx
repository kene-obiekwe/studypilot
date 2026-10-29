import styles from "./auth.module.css";

export const JUNK_FOLDER_HINT = "Can't find it? Check your spam or junk folder. It can take a minute.";

/** Plain-text reminder under a "we emailed you a code" heading; shared senders often land in junk. */
export function JunkFolderHint() {
  return <p className={styles.hint}>{JUNK_FOLDER_HINT}</p>;
}
