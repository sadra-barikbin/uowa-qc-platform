# HCM curriculum evidence (seed assets)

Real evidence documents for the **إدارة المؤسسات الصحية (HCM)** department, indicator
**المناهج والتحديث (`curriculum-update`)**, used by `utils/seedData.ts`. On seed, each PDF is
copied into `backend/uploads/` and registered as a `SubmissionDocument`; the submissions are left
**unevaluated** so `POST /api/evaluations/ai` is what scores them.

Source: QC department Google Drive folder
`https://drive.google.com/drive/folders/14Nw0SbinWkV0Hlk1dqs_aLSCD7oErPJk`

Place the files at these **exact paths / names** (the seed looks them up by name):

## `forms/` — criterion `update-form` (استمارة تحديث المقررات)

| Local path                     | Drive file                                                      | Drive file ID                       |
| ------------------------------ | -------------------------------------------------------------- | ----------------------------------- |
| `forms/computer.pdf`           | تحديث منهج الحاسوب.pdf                                          | `1c7p2ResbpCdsiWxbkV2J97_Ic4g6AW4w` |
| `forms/english.pdf`            | تحديث مننهج اللغة الانكليزية.pdf                                | `1H4jpTVaipIXl78o_nQ_WELnKdC3g1THE` |
| `forms/economics.pdf`          | تحديث مادة مبادئ الاقتصاد.pdf                                   | `1C2e8FX376Z5dWHOD76wq0AXS6YZBQZWs` |
| `forms/statistics.pdf`         | تحديث مادة الاحصاء.pdf                                          | `1PWRqM8DWbofYtMYZSJhGkGc9m-8yDjvK` |
| `forms/medical-terms.pdf`      | تحديث مادة مصطلحات طبية.pdf                                     | `1ifzgQZMZOzHM7gw_vIRkI3d_nWr9pdMK` |
| `forms/health-it.pdf`          | تحديث مادة تكنولوجيا المعلومات لذوي المهن الصحية.pdf            | `1xsdKB7m3qeTzwf-EqD8ECyNAJKtt0qo8` |
| `forms/behavioral-ethics.pdf`  | تحديث العلوم السلوكية والاخلاقية.pdf                           | `1BThz6qEa86pQr-yU6rcpKuSPXR6DlXXC` |

## `comparison/` — criterion `curriculum-comparison` (مقارنة المناهج مع الجامعات العالمية)

| Local path                          | Drive file                                             | Drive file ID                       |
| ----------------------------------- | ------------------------------------------------------ | ----------------------------------- |
| `comparison/comparison-minutes.pdf` | محضر_اجتماع_مقارنة_المناهج_العلمية_لقسم_.pdf           | `1PBEkaqRTy_9qQZwpNukZKkDCdfpgPjLR` |

## Deferred (supporting reference, NOT fed to the evaluator yet)

These live in the same Drive "مقارنة المناهج" subfolder but are reference material, not gradeable
evidence. They'll belong in a future "supporting documents" upload section (see the `feed_to_evaluator`
idea). Do not place them here for now.

- `AURAK Arabic Profile.pdf` — `1PBEYn5BPqa9pnTcItDvYHL49P2MWA5Hp`
- `Fact Sheet RAK (Arabic).pdf` — `1WNZBvk3ZOHmauwxyyhK078GF9q_zWxZl`

> Note: these PDFs contain real staff names/signatures. They are committed to the repo as fixtures —
> keep that in mind before pushing to any public remote.
