"""Evidence-based study techniques the engine can recommend.

Each technique has display templates (title, what, how) and one well-established source.
Templates are filled with plain parameters such as {course} or {block}; nothing here reads
the database or decides *whether* to recommend a technique (see selection.py).
"""

from __future__ import annotations

from dataclasses import dataclass, field

# Kinds. "Behaviour" kinds compete for the same slots in selection.
TECHNIQUE = "technique"
SCHEDULE = "schedule"
HABIT = "habit"
FOCUS = "focus"
EXAM = "exam"
BEHAVIOUR_KINDS = frozenset({SCHEDULE, HABIT, FOCUS})


@dataclass(frozen=True)
class Source:
    citation: str
    short: str
    note: str | None = None

    def as_dict(self) -> dict:
        data = {"citation": self.citation, "short": self.short}
        if self.note:
            data["note"] = self.note
        return data


@dataclass(frozen=True)
class Variant:
    what: str
    how: tuple[str, ...]


@dataclass(frozen=True)
class Technique:
    id: str
    title: str
    kind: str
    source: Source
    variants: dict[str, Variant] = field(default_factory=dict)

    def render(self, variant: str = "default", **params) -> tuple[str, list[str]]:
        chosen = self.variants.get(variant) or self.variants["default"]
        return chosen.what.format(**params), [step.format(**params) for step in chosen.how]


DUNLOSKY_2013 = Source(
    "Dunlosky, J., Rawson, K. A., Marsh, E. J., Nathan, M. J., & Willingham, D. T. (2013). Improving "
    "students' learning with effective learning techniques. Psychological Science in the Public Interest.",
    "Dunlosky et al., 2013",
)
ROEDIGER_KARPICKE_2006 = Source(
    "Roediger, H. L., & Karpicke, J. D. (2006). Test-enhanced learning: Taking memory tests improves "
    "long-term retention. Psychological Science.",
    "Roediger & Karpicke, 2006",
)
CEPEDA_2006 = Source(
    "Cepeda, N. J., Pashler, H., Vul, E., Wixted, J. T., & Rohrer, D. (2006). Distributed practice in "
    "verbal recall tasks: A review and quantitative synthesis. Psychological Bulletin.",
    "Cepeda et al., 2006",
)

WARMUP_STEP = "Spend the first 5–10 minutes recalling, from memory, the earlier topic this one builds on."

_TECHNIQUES = [
    Technique(
        "worked_examples",
        "Study worked examples first",
        TECHNIQUE,
        Source(
            "Sweller, J., & Cooper, G. A. (1985). The use of worked examples as a substitute for problem "
            "solving in learning algebra. Cognition and Instruction.",
            "Sweller & Cooper, 1985",
        ),
        {
            "default": Variant(
                "Learn from fully worked solutions before solving problems on your own.",
                (
                    "Read a fully worked solution and name the purpose of each step.",
                    "Cover it and redo the solution from memory.",
                    "Solve a near-identical problem on your own, then move to a new type.",
                    "Work in {block}-minute blocks.",
                ),
            )
        },
    ),
    Technique(
        "interleaving",
        "Mix problem types",
        TECHNIQUE,
        Source(
            "Rohrer, D., & Taylor, K. (2007). The shuffling of mathematics problems improves learning. "
            "Instructional Science.",
            "Rohrer & Taylor, 2007",
        ),
        {
            "default": Variant(
                "Mix different problem types in one session instead of practising one type at a time.",
                (
                    "Pick problems from 3 topics you've already covered.",
                    "Shuffle them so consecutive problems need different methods.",
                    "Before solving each one, name the method it needs.",
                ),
            )
        },
    ),
    Technique(
        "retrieval_practice",
        "Test yourself instead of rereading",
        TECHNIQUE,
        ROEDIGER_KARPICKE_2006,
        {
            "default": Variant(
                "Recall material from memory instead of rereading it.",
                (
                    "Close your notes and write down everything you remember about one topic.",
                    "Check against your notes and mark what you missed.",
                    "Start the next session by recalling the missed parts first.",
                ),
            ),
            "problem": Variant(
                "Solve problems from memory instead of rereading solutions.",
                (
                    "Close your notes and solve 3–5 problems from topics you've covered.",
                    "Check each answer against the solution.",
                    "Redo every problem you missed at the start of the next session.",
                ),
            ),
            "essay": Variant(
                "Rebuild your arguments from memory instead of rereading notes.",
                (
                    "On a blank page, write the main argument and evidence for one topic from memory.",
                    "Check against your notes and add what you missed in a different colour.",
                    "Repeat for the same topic in a later session until nothing is missing.",
                ),
            ),
        },
    ),
    Technique(
        "flashcard_self_testing",
        "Self-test with flashcards",
        TECHNIQUE,
        Source(
            "Karpicke, J. D., & Roediger, H. L. (2008). The critical importance of retrieval for learning. Science.",
            "Karpicke & Roediger, 2008",
        ),
        {
            "default": Variant(
                "Test yourself with flashcards instead of rereading lists.",
                (
                    "Write a question or term on the front and the answer on the back.",
                    "Say the answer out loud before you flip the card.",
                    "Keep missed cards in the deck; retire a card only after recalling it correctly on separate days.",
                ),
            )
        },
    ),
    Technique(
        "self_explanation",
        "Explain each step to yourself",
        TECHNIQUE,
        Source(
            "Chi, M. T. H., Bassok, M., Lewis, M. W., Reimann, P., & Glaser, R. (1989). Self-explanations: How "
            "students study and use examples in learning to solve problems. Cognitive Science.",
            "Chi et al., 1989",
        ),
        {
            "default": Variant(
                "Explain to yourself why each step or idea follows.",
                (
                    "Pause after each step of a derivation or each paragraph you read.",
                    "Say or write why it follows from what came before.",
                    "Mark the points you can't explain and look them up before moving on.",
                ),
            )
        },
    ),
    Technique(
        "elaborative_interrogation",
        'Ask "why is this true?"',
        TECHNIQUE,
        DUNLOSKY_2013,
        {
            "default": Variant(
                "Turn key facts into why and how questions and answer them.",
                (
                    "Write a why or how question for each key idea in today's topic.",
                    "Answer it in your own words without notes.",
                    "Link each answer to something you already know.",
                ),
            )
        },
    ),
    Technique(
        "plan_then_write",
        "Outline before you write",
        TECHNIQUE,
        Source(
            "Graham, S., & Perin, D. (2007). A meta-analysis of writing instruction for adolescent students. "
            "Journal of Educational Psychology.",
            "Graham & Perin, 2007",
            note="Meta-analysis of school-age writers.",
        ),
        {
            "default": Variant(
                "Outline your argument before you start writing.",
                (
                    "Write your thesis in one sentence.",
                    "List 3–5 claims, each with the evidence that supports it.",
                    "Write from the outline, then check every paragraph against it.",
                ),
            )
        },
    ),
    Technique(
        "deliberate_practice",
        "Practise the hard part with feedback",
        TECHNIQUE,
        Source(
            "Ericsson, K. A., Krampe, R. T., & Tesch-Römer, C. (1993). The role of deliberate practice in the "
            "acquisition of expert performance. Psychological Review.",
            "Ericsson et al., 1993",
        ),
        {
            "default": Variant(
                "Practise the specific sub-skill that goes wrong most often, with feedback after each round.",
                (
                    "Pick the one part of the task you get wrong most often.",
                    "Repeat just that part in short rounds.",
                    "Check each round against a reference, a test or a peer before the next one.",
                ),
            )
        },
    ),
    Technique(
        "prerequisite_warmup",
        "Warm up on earlier topics",
        TECHNIQUE,
        DUNLOSKY_2013,
        {
            "default": Variant(
                "Start each session by recalling the earlier topics this one builds on.",
                (WARMUP_STEP, "Fix any gaps before you start new material."),
            )
        },
    ),
    Technique(
        "format_matched_practice",
        "Practise in the exam's format",
        EXAM,
        Source(
            "Morris, C. D., Bransford, J. D., & Franks, J. J. (1977). Levels of processing versus transfer "
            "appropriate processing. Journal of Verbal Learning and Verbal Behavior.",
            "Morris et al., 1977",
        ),
        {
            "default": Variant(
                "Practise with questions in the same format as your exam.",
                (
                    "Find past or practice questions in the exam's format.",
                    "Answer them under exam conditions.",
                    "Review the topics behind every miss.",
                ),
            ),
            "timed_problem_exam": Variant(
                "Practise past-paper problems against the clock.",
                (
                    "Pick a past-paper section and give yourself the exam's time per question.",
                    "Work without notes, then mark against the solutions.",
                    "Redo every missed problem two days later.",
                ),
            ),
            "multiple_choice": Variant(
                "Practise multiple-choice questions and explain every option.",
                (
                    "Answer a set of practice questions against the clock.",
                    "For each question, say why every wrong option is wrong.",
                    "Revisit the topics behind your misses.",
                ),
            ),
            "essay_exam": Variant(
                "Practise writing timed essay plans.",
                (
                    "Pick a past question and give yourself 10 minutes to plan an answer.",
                    "Write the thesis and claim headings only.",
                    "Compare with your notes and fill the gaps.",
                ),
            ),
            "coursework": Variant(
                "Work to draft milestones and get feedback before the deadline.",
                (
                    "Set a date for a complete first draft.",
                    "Get feedback on the draft from a tutor, a peer or the marking guide.",
                    "Revise against the feedback before you submit.",
                ),
            ),
            "continuous_quizzes": Variant(
                "Quiz yourself before each graded quiz.",
                (
                    "The day before each quiz, answer practice questions on its topics without notes.",
                    "Check your answers and review only what you missed.",
                ),
            ),
        },
    ),
    Technique(
        "mock_exam",
        "Sit a full mock under exam conditions",
        EXAM,
        ROEDIGER_KARPICKE_2006,
        {
            "default": Variant(
                "Sit one full practice exam under real conditions, then focus on your weakest topics.",
                (
                    "Do a full past paper or mock in one sitting, timed and without notes.",
                    "Mark it honestly.",
                    "Spend the remaining sessions only on your weakest topics, with no new material.",
                ),
            )
        },
    ),
    Technique(
        "split_long_sessions",
        "Split long sessions into shorter ones",
        SCHEDULE,
        CEPEDA_2006,
        {
            "default": Variant(
                "Keep the same total study time, but spread it over shorter sessions on different days.",
                (
                    "Replace each {long_minutes}-minute session with {n_blocks} sessions of {block} minutes "
                    "on different days.",
                    "Set one concrete goal for each session.",
                ),
            )
        },
    ),
    Technique(
        "spaced_schedule",
        "Spread sessions across the week",
        SCHEDULE,
        CEPEDA_2006,
        {
            "default": Variant(
                "Spread {course} across several days instead of studying it in one sitting.",
                (
                    "Put {course} on at least 3 separate days this week.",
                    "Keep each gap to 2–3 days at most.",
                    "Start each session with 5 minutes recalling the previous one.",
                ),
            )
        },
    ),
    Technique(
        "implementation_intentions",
        "Fix when and where you'll study",
        HABIT,
        Source(
            "Gollwitzer, P. M., & Sheeran, P. (2006). Implementation intentions and goal achievement: A "
            "meta-analysis of effects and processes. Advances in Experimental Social Psychology.",
            "Gollwitzer & Sheeran, 2006",
        ),
        {
            "default": Variant(
                "Decide exactly when and where each {course} session will happen.",
                (
                    'For each session this week, write: "On [day] at [time] in [place] I will study {course} '
                    'for [minutes] minutes."',
                    "Put each one in your calendar.",
                    "If you miss one, re-plan it the same day.",
                ),
            )
        },
    ),
    Technique(
        "right_size_plans",
        "Plan sessions you'll actually finish",
        HABIT,
        Source(
            "Buehler, R., Griffin, D., & Ross, M. (1994). Exploring the \"planning fallacy\": Why people "
            "underestimate their task completion times. Journal of Personality and Social Psychology.",
            "Buehler et al., 1994",
        ),
        {
            "default": Variant(
                "Plan sessions close to the time you really study, then build up.",
                (
                    "For now, plan about {plan_minutes} minutes per session, close to what you actually study.",
                    "Add 10–15 minutes once you've finished 3 sessions in a row as planned.",
                ),
            )
        },
    ),
    Technique(
        "phone_out_of_room",
        "Keep your phone in another room",
        FOCUS,
        Source(
            "Ward, A. F., Duke, K., Gneezy, A., & Bos, M. W. (2017). Brain drain: The mere presence of one's own "
            "smartphone reduces available cognitive capacity. Journal of the Association for Consumer Research.",
            "Ward et al., 2017",
            note=(
                "Evidence is mixed: later replications of this finding were inconsistent; keeping the phone out "
                "of reach is a low-cost precaution."
            ),
        ),
        {
            "default": Variant(
                "Study with your phone out of the room, not just face down.",
                (
                    "Put your phone in another room before you start.",
                    "Turn off notifications on your computer.",
                    "Check messages only during breaks.",
                ),
            )
        },
    ),
]

LIBRARY: dict[str, Technique] = {technique.id: technique for technique in _TECHNIQUES}
# Library order breaks priority ties deterministically.
LIBRARY_ORDER: dict[str, int] = {technique.id: index for index, technique in enumerate(_TECHNIQUES)}

# Learning demand -> techniques that serve it, best first.
DEMAND_TECHNIQUES: dict[str, tuple[str, ...]] = {
    "problem_solving": ("worked_examples", "interleaving", "retrieval_practice"),
    "conceptual": ("self_explanation", "elaborative_interrogation"),
    "memorisation": ("flashcard_self_testing",),
    "writing": ("plan_then_write", "retrieval_practice"),
    "practical": ("deliberate_practice",),
}
DEFAULT_TECHNIQUES: tuple[str, ...] = ("retrieval_practice",)

DEMAND_LABELS: dict[str, str] = {
    "problem_solving": "problem solving",
    "conceptual": "conceptual understanding",
    "memorisation": "memorisation",
    "writing": "writing",
    "practical": "practical work",
}

FORMAT_LABELS: dict[str, str] = {
    "timed_problem_exam": "timed problem exam",
    "multiple_choice": "multiple-choice exam",
    "essay_exam": "essay exam",
    "coursework": "coursework",
    "continuous_quizzes": "continuous quizzes",
}
