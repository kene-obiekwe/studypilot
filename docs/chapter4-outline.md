# Chapter 4 Draft Outline (Implementation)

## 4.1 Development Environment and Tools

- Frontend: Next.js
- Backend: Django + DRF
- Database: PostgreSQL
- Version control: GitHub

## 4.2 System Implementation Architecture

- Client-server model
- API contracts
- Data flow for planner and recommendation

## 4.3 Module Implementation

1. Authentication and profile module
2. Study planning and optimisation module
3. Recommendation module
4. Progress tracking module
5. Reminder module

## 4.4 AI Methodology and Model Development

1. AI problem definition and target variables
2. Data sources and dataset construction
3. Data preprocessing and feature engineering
4. Model selection and baseline definition
5. Training procedure and hyperparameter tuning
6. Testing and evaluation metrics
7. Model artifact versioning and deployment workflow

### Implementation Notes (Current System)

- Planner optimisation loop: study allocations are adjusted using recent adherence predictions per course.
- Recommendation confidence: heuristic confidence score is returned with strategy suggestions and stored for history.

## 4.5 User Interface Implementation

- Screens and interaction flow
- Mobile responsiveness

## 4.6 Testing and Validation

- Functional testing
- API testing
- AI model testing (offline metrics + online behavior checks)
- Pilot user feedback

## 4.7 Ethical, Privacy, and Reliability Considerations

- Data consent and anonymization
- Bias/fairness checks for recommendations
- Failure fallback to rule-based recommendations
