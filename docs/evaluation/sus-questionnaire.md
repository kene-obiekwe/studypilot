# SUS Questionnaire — Copy-Paste Guide for Google Forms

Use this guide to create the evaluation Google Form. Section titles, field labels and option text are written so you can copy each block straight into the corresponding Google Forms input.

The instrument is the standard **System Usability Scale** (Brooke, 1986) of ten items, scored on a five-point Likert scale. Two short demographic items at the top let you describe the participant sample without identifying any respondent.

## Form-level settings

- **Form title:** StudyPilot AI — Usability Evaluation
- **Form description:**

> Thank you for taking part in this evaluation. You have just used StudyPilot AI, a personalised study planning and learning recommendation web application. This short questionnaire takes about three minutes and helps measure how usable the system is. There are no right or wrong answers. Your responses are anonymous and will only be reported as aggregate statistics in the final year project report.

- **Collect email addresses:** Off
- **Limit to one response:** Off
- **Shuffle question order:** Off (item order matters for SUS scoring)

## Section 1 — Background (2 short questions)

These let you describe the participant sample in §4.3.2 without identifying any individual.

### Question 1

- **Type:** Multiple choice
- **Question text:** Which year of study are you currently in?
- **Required:** Yes
- **Options:**
  1. Year 1
  2. Year 2
  3. Year 3
  4. Year 4
  5. Postgraduate / other

### Question 2

- **Type:** Multiple choice
- **Question text:** Have you used a digital study planner or learning app before?
- **Required:** Yes
- **Options:**
  1. Never
  2. Once or twice
  3. Occasionally
  4. Regularly

## Section 2 — System Usability Scale

Set this section's title to **System Usability Scale** with the description:

> For each of the following statements about StudyPilot AI, please indicate how strongly you agree or disagree. Choose the response that best reflects your experience with the system just now.

For every one of the ten items below:

- **Type:** Linear scale
- **Scale:** 1 to 5
- **Label for 1:** Strongly disagree
- **Label for 5:** Strongly agree
- **Required:** Yes

### Item 1

I think that I would like to use this system frequently.

### Item 2

I found the system unnecessarily complex.

### Item 3

I thought the system was easy to use.

### Item 4

I think that I would need the support of a technical person to be able to use this system.

### Item 5

I found the various functions in this system were well integrated.

### Item 6

I thought there was too much inconsistency in this system.

### Item 7

I would imagine that most people would learn to use this system very quickly.

### Item 8

I found the system very cumbersome to use.

### Item 9

I felt very confident using the system.

### Item 10

I needed to learn a lot of things before I could get going with this system.

## Closing message

After the participant submits, configure Google Forms to show this confirmation:

> Thank you. Your response has been recorded. Please return the device to the researcher.

## Exporting the responses

Once at least ten participants have completed the form:

1. Open the form, choose **Responses → View in Sheets**.
2. In the resulting Google Sheet choose **File → Download → Comma-separated values (.csv)**.
3. Save the file as `sus-responses.csv` in `docs/evaluation/data/`.
4. Run `python docs/evaluation/score_sus.py docs/evaluation/data/sus-responses.csv` to generate per-participant scores, summary statistics, and the histogram figure used in §4.3.3.

The analysis script expects the ten SUS items to appear in the order above. Do not reorder or rename the questions in the form after the first response is collected; doing so would break the column mapping.
