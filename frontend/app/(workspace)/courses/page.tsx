import Link from "next/link";
import { BookOpen } from "lucide-react";

import styles from "@/components/app-shell/shell.module.css";
import { EmptyState } from "@/components/ui";

/** "Courses". Course management (traits, exam dates, colours) arrives in 5.3b. */
export default function CoursesPage() {
  return (
    <div className={styles.page}>
      <EmptyState
        icon={<BookOpen size={28} />}
        title="Your courses will live here"
        description="Soon you'll add courses, their exam dates and how they're assessed. For now, courses come from the planner."
        action={
          <Link href="/planner" className={styles.linkButton}>
            Open the planner
          </Link>
        }
      />
    </div>
  );
}
