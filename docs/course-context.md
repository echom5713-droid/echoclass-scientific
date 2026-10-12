# Reading EchoClass as a scientific software project

For Edinburgh’s MSc High Performance Computing with Data Science, this prototype supplies a concrete route through Python analysis, data representation and reproducible software. EPCC describes practical, maintainable and scalable scientific software as a central theme: https://www.epcc.ed.ac.uk/education-training/masters-programmes-high-performance-computing-hpc-and-hpc-data-science (checked 12 October 2026). The current work demonstrates the small-data analysis and engineering portion; parallel decomposition, performance measurement and scaling remain further work. Course descriptions are context, not an admissions scoring rubric.

The connection to Data Intensive Science is the path from observations to a defensible calculation. Citrus extraction supplies a concrete domain; the questions concern data provenance, statistical assumptions and reproducible software.

Cambridge's [DIS overview](https://www.postgraduate.study.cam.ac.uk/courses/directory/pcphmpdis) describes scientific analysis pipelines, statistical and machine-learning methods, collaborative research software and open science. Its [study page](https://www.postgraduate.study.cam.ac.uk/courses/directory/pcphmpdis/study) gives particular weight to reproducibility, assessment of analytical methods and explaining a pipeline's results. These public descriptions were checked on 4 October 2026; they are course aims, not an admissions scoring rubric.

| Course theme                     | Inspectable work in this repository                                                                                                | What it does not establish                                                                   |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Reproducible scientific analysis | Sealed observations and review decisions; code and environment identities; rerunning saved inputs                                  | That a measurement was truthful, or an experiment independently replicated                   |
| Statistical reasoning            | Group-level validation, simple baselines and a deliberately misspecified response curve in the [method study](method-study.md)     | That four tested concentrations identify the unmeasured response or an optimum               |
| Research software                | Transactions, durable submission identities, supervised Python work, strict result validation and regression tests                 | Unlimited scale, complete security, or production readiness                                  |
| Accessible analysis pipelines    | A synthetic command-line case, a fixed simulation study and a [scientific container](scientific-deployment.md)                     | Identical host kernels or bitwise results on every architecture                              |
| Communication and scrutiny       | Full per-trial outputs, reproducible figures, retained counterexamples and a [Chinese code walkthrough](project-walkthrough-zh.md) | Independent authorship of AI-assisted work, or understanding without running and studying it |

## The question worth pursuing

Suppose two response functions agree at every concentration we measured. A pipeline receives the same records, returns the same fitted curve and passes the same cross-validation checks. Can it distinguish what happens between those concentrations?

The method study constructs that counterexample explicitly. It compares the production quadratic with constant and linear baselines using a fixed set of scenarios and random seeds. The unseen response is known because the study is synthetic. That lets us separate reproducibility of a calculation from identification of the underlying response. Reporting the failure is part of the result.

The engineering work supports this question. An analysis has to preserve which observations were used, how inclusion was decided, which code ran and how failures were handled before its method comparison is useful.

The [follow-up design](followup-design.md) closes one small reasoning loop: a failure of identification becomes a proposed new measurement, an explicit noise model, an analytic decision error and a reproducible simulation check. Its interactive example also makes the assumptions available for scrutiny. This is a restricted two-hypothesis calculation, not a claim of general experiment-design expertise.

## Boundaries that remain

This is a small-data scientific prototype. It does not demonstrate distributed computing, GPU programming, large-scale ingestion or high-performance-computing proficiency. It also does not reproduce a published scientific paper. A future literature-reproduction project would need an identified source, usable data and licences, a specified target result and a recorded comparison with the original analysis.

The assistant currently retrieves versioned first-party text and presents bounded evidence cards. This is useful provenance work, but it is not a trained scientific machine-learning model or a validated general-purpose research assistant.

The repository is the technical evidence. Personal application claims must be based on work the owner has actually understood and verified. The [development notes](engineering-notes.md#development-and-tool-assistance) retain the scope of AI assistance; the [risk register](risk-register.md) retains the unresolved release conditions.
