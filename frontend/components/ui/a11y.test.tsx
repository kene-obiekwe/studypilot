// @vitest-environment jsdom
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { cleanup, click, render } from "@/test/dom";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { Badge } from "./Badge";
import { Button, IconButton } from "./Button";
import { Checkbox } from "./Checkbox";
import { Disclosure } from "./Disclosure";
import { EmptyState } from "./EmptyState";
import { Field, Input, Select, Textarea } from "./Field";
import { NavItem } from "./NavItem";
import { Notice } from "./Notice";
import { ProgressBar } from "./ProgressBar";
import { SegmentedControl } from "./SegmentedControl";

afterEach(cleanup);

/**
 * axe in jsdom: structure, names, roles and ARIA. Colour contrast is not computed here (jsdom has no
 * layout); the token pairs are covered by styles/tokens.test.ts and the pages were scanned in a real browser.
 * Page-level rules (landmarks, headings, title) don't apply to a fragment.
 */
async function violations(container: HTMLElement): Promise<string[]> {
  const result = await axe.run(container, {
    rules: {
      "color-contrast": { enabled: false },
      region: { enabled: false },
      "page-has-heading-one": { enabled: false },
      "landmark-one-main": { enabled: false },
    },
  });
  return result.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`);
}

describe("primitives pass axe", () => {
  it("fields, with and without hints and errors", async () => {
    const { container } = await render(
      <form>
        <Field label="Course name" required>
          <Input name="name" />
        </Field>
        <Field label="Hours" hint="From 1 to 168." error="Enter a number.">
          <Input name="hours" type="number" />
        </Field>
        <Field label="Format">
          <Select name="format">
            <option value="">Not set</option>
            <option value="coursework">Coursework</option>
          </Select>
        </Field>
        <Field label="Notes">
          <Textarea name="notes" />
        </Field>
      </form>,
    );
    expect(await violations(container)).toEqual([]);
  });

  it("keeps a control labelled even when it is given its own id", async () => {
    const { container } = await render(
      <Field label="Hours you can study">
        <Input id="my-own-id" name="hours" />
      </Field>,
    );
    const input = container.querySelector("input") as HTMLInputElement;
    expect(input.labels?.[0]?.textContent).toContain("Hours you can study");
    expect(await violations(container)).toEqual([]);
  });

  it("checkboxes are named by their visible label, not their value", async () => {
    const { container } = await render(
      <fieldset>
        <legend>What does it ask of you?</legend>
        <Checkbox label="Problem solving" name="learning_demands" value="problem_solving" />
        <Checkbox label="Conceptual understanding" name="learning_demands" value="conceptual" hint="Ideas, not formulas" />
      </fieldset>,
    );
    const names = [...container.querySelectorAll("input")].map((input) => input.labels?.[0]?.textContent?.trim());
    expect(names[0]).toBe("Problem solving");
    expect(names[1]).toContain("Conceptual understanding");
    expect(await violations(container)).toEqual([]);
  });

  it("buttons, segmented controls, disclosures, notices, badges, progress and navigation", async () => {
    const { container } = await render(
      <div>
        <Button variant="primary">Save</Button>
        <Button variant="ghost">Helpful</Button>
        <IconButton aria-label="Close" icon={<span>x</span>} />
        <SegmentedControl
          label="Difficulty"
          options={[
            { value: "1", label: "1" },
            { value: "2", label: "2" },
          ]}
          value="1"
          onChange={() => undefined}
        />
        <Disclosure summary="How is this worked out?">
          <p>Explained here.</p>
        </Disclosure>
        <Notice tone="danger" title="Could not save">
          Try again.
        </Notice>
        <Badge tone="exam">Exam in 6 days</Badge>
        <ProgressBar label="This week" value={3} max={10} valueText="3 of 10 h" />
        <EmptyState title="Add your first course" description="Plans are built per course." />
        <nav aria-label="Main">
          <NavItem href="/home" label="This week" icon={<span />} active />
        </nav>
      </div>,
    );
    expect(await violations(container)).toEqual([]);
  });

  it("a loading button keeps keyboard focus and ignores clicks and form submits", async () => {
    const onClick = vi.fn();
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    const { container } = await render(
      <form onSubmit={onSubmit}>
        <Button loading onClick={onClick}>
          Suggest from name
        </Button>
        <Button loading type="submit">
          Save
        </Button>
      </form>,
    );
    const [plain, submit] = [...container.querySelectorAll("button")] as HTMLButtonElement[];
    plain.focus();
    expect(document.activeElement).toBe(plain);
    await click(plain);
    await click(submit);
    expect(onClick).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(plain);
    expect(await violations(container)).toEqual([]);
  });
});
