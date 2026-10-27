import { useEffect, useRef, useState } from "react";

/**
 * "Show more" paging. Pressing the button reveals another page; when that was the last page the button
 * disappears, so focus moves to the status line instead of being lost to the page body. Attach `statusRef`
 * to a paragraph with tabIndex={-1}.
 */
export function useShowMore(total: number, pageSize: number) {
  const [visible, setVisible] = useState(pageSize);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const pressed = useRef(false);
  const done = visible >= total;

  useEffect(() => {
    if (!pressed.current) return;
    pressed.current = false;
    if (done) statusRef.current?.focus();
  });

  const showMore = () => {
    pressed.current = true;
    setVisible((count) => count + pageSize);
  };

  return { visible, done, showMore, statusRef };
}
