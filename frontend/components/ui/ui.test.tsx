import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { Badge, CourseDot } from "./Badge";
import { Button, IconButton } from "./Button";
import { Checkbox } from "./Checkbox";
import { Disclosure } from "./Disclosure";
import { Field, Input, Select } from "./Field";
import { NavItem } from "./NavItem";
import { Notice } from "./Notice";
import { ProgressBar } from "./ProgressBar";
import { SegmentedControl } from "./SegmentedControl";
import { Skeleton } from "./Skeleton";
import { Stat } from "./Stat";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

function attr(markup: string, name: string): string | null {
  const match = new RegExp(`${name}="([^"]*)"`).exec(markup);
  return match ? match[1] : null;
}

describe("Button", () => {
  it("defaults to type=button and marks loading as busy and disabled", () => {
    expect(html(<Button>Save</Button>)).toContain('type="button"');
    const loading = html(<Button loading>Save</Button>);
    expect(loading).toContain('aria-busy="true"');
    expect(loading).toContain("disabled");
    expect(loading).toContain("Save");
  });

  it("IconButton carries its label and hides the icon from assistive tech", () => {
    const markup = html(<IconButton aria-label="Close" icon={<svg />} />);
    expect(attr(markup, "aria-label")).toBe("Close");
    expect(markup).toContain('aria-hidden="true"');
  });
});

describe("Field", () => {
  it("links the label, hint and error to the control", () => {
    const markup = html(
      <Field label="Course name" hint="As it appears on your timetable" error="Name is required" required>
        <Input />
      </Field>,
    );
    const inputId = attr(markup.slice(markup.indexOf("<input")), "id");
    expect(markup).toContain(`for="${inputId}"`);
    const describedBy = attr(markup.slice(markup.indexOf("<input")), "aria-describedby")!.split(" ");
    expect(describedBy).toHaveLength(2);
    for (const id of describedBy) expect(markup).toContain(`id="${id}"`);
    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain("required");
  });

  it("leaves a valid control unmarked", () => {
    const markup = html(
      <Field label="Format">
        <Select>
          <option>Essay exam</option>
        </Select>
      </Field>,
    );
    expect(markup).not.toContain("aria-invalid");
    expect(markup).not.toContain("aria-describedby");
  });
});

describe("other primitives", () => {
  it("Checkbox is a native checkbox inside its label", () => {
    const markup = html(<Checkbox label="Tried it" hint="Sends feedback" defaultChecked />);
    expect(markup).toContain('type="checkbox"');
    expect(markup.startsWith("<label")).toBe(true);
    expect(attr(markup, "aria-describedby")).toBeTruthy();
  });

  it("SegmentedControl is a radio group with one tab stop", () => {
    const markup = html(
      <SegmentedControl
        label="Theme"
        value="dark"
        onChange={() => {}}
        options={[
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark" },
        ]}
      />,
    );
    expect(markup).toContain('role="radiogroup"');
    expect(markup).toContain('aria-label="Theme"');
    expect(markup.match(/role="radio"/g)).toHaveLength(2);
    expect(markup.match(/tabindex="0"/g)).toHaveLength(1);
    expect(markup).toMatch(/aria-checked="true"[^>]*tabindex="0"[^>]*>Dark|tabindex="0"[^>]*aria-checked="true"/);
  });

  it("ProgressBar exposes its values and clamps them", () => {
    const markup = html(<ProgressBar label="Calculus" value={4.5} max={3.5} valueText="4.5 of 3.5 h" courseId={3} />);
    expect(markup).toContain('role="progressbar"');
    expect(attr(markup, "aria-valuenow")).toBe("3.5");
    expect(attr(markup, "aria-valuemax")).toBe("3.5");
    expect(attr(markup, "aria-valuetext")).toBe("4.5 of 3.5 h");
    expect(markup).toContain("--course-dot:var(--sp-course-3-dot)");
  });

  it("Notice uses alert only for danger", () => {
    expect(html(<Notice tone="danger" title="Couldn't save" />)).toContain('role="alert"');
    expect(html(<Notice tone="success" title="Saved" />)).toContain('role="status"');
  });

  it("course-coloured badge and dot use the course variables", () => {
    expect(html(<Badge tone="course" courseId={9}>Calculus</Badge>)).toContain("--course-tint:var(--sp-course-1-tint)");
    expect(html(<CourseDot courseId={9} />)).toContain('aria-hidden="true"');
  });

  it("NavItem marks the current page", () => {
    expect(html(<NavItem href="/week" label="This week" active />)).toContain('aria-current="page"');
    expect(html(<NavItem href="/week" label="This week" />)).not.toContain("aria-current");
  });

  it("Stat, Skeleton and Disclosure render their contracts", () => {
    expect(html(<Stat label="This week" value="7.5" unit="of 12 h" />)).toContain("7.5");
    expect(html(<Skeleton />)).toContain('aria-hidden="true"');
    const details = html(<Disclosure>Based on 8 sessions</Disclosure>);
    expect(details).toContain("<details");
    expect(details).toContain("Why?");
  });
});
