# References

Every number in the [README](../README.md) links to an entry here. A figure without a source is not used.

## Problem statistics

| ID | Claim | Source |
|---|---|---|
| R1 | "Only 5.65 crore workers are registered under the act, against 7.1 crore working in the sector." | Utkarsh Mishra, [*A Law Only on Paper: Welfare for Construction Workers*](https://www.theindiaforum.in/forum/law-only-paper-welfare-construction-workers), The India Forum, 20 Feb 2026 |
| R2 | A worker is eligible to register as a beneficiary (the gateway to board benefits) only after at least 90 days of building work in the preceding 12 months | Building and Other Construction Workers Act, 1996, Section 12 ([Chief Labour Commissioner](https://clc.gov.in/clc/acts-rules/building-and-other-construction-workers)). The Act was subsumed into the Code on Social Security, 2020, in force from 21 Nov 2025 ([PIB](https://www.pib.gov.in/PressReleseDetailm.aspx?PRID=2192463&reg=3&lang=2)) |
| R3 | Haryana: between 2018 and 31 Jan 2025, 10,81,809 workers applied online to the welfare board; 1,85,429 were registered and 8,06,148 applications were rejected (about 75%) | RTI reply, reported in [*Hands that build, denied their share of welfare*](https://www.tribuneindia.com/news/haryana/hands-that-build-denied-their-share-of-welfare/), The Tribune, 11 Mar 2026 |
| R4 | Karnataka: "Of the 51 lakh registered workers at the time, 19 lakh fake cards have since been cancelled through background checks and surveys." (A. H. Umesha, Joint Secretary, Karnataka BOCW Welfare Board) | [Citizen Matters](https://citizenmatters.in/karnataka-welfare-board-benefits-bengaluru-construction-workers-demands/), 24 Oct 2025 |
| R5 | Cumulative cess collected by state and UT boards: ₹1,12,331.09 crore as on 31 Mar 2024, of which 57.15% was spent. The unspent 42.85% is about ₹48,134 crore (our arithmetic). | Ministry of Labour and Employment data, reported in [*Nearly 50% of construction workers' welfare cess funds unutilised*](https://www.business-standard.com/economy/news/nearly-50-of-construction-workers-welfare-cess-funds-unutilised-124102901356_1.html), Business Standard, 29 Oct 2024 |

**Older figures, superseded:** a Rajya Sabha reply in Dec 2022 gave 5.06 crore registered workers and ₹38,209 crore unspent as on 1 Nov 2022 ([ETV Bharat](https://www.etvbharat.com/english/bharat/building-other-construction-workers-boards-have-rs-38209-cr-unused-rameswar-teli/na20221215165109809809514)). We quote the newer figures above instead.

## Prices used in the cost estimate

List prices, checked 27 Sep 2026. AWS prices are for Asia Pacific (Mumbai), read from the AWS Price List API.

| ID | Item | Price | Source |
|---|---|---|---|
| P1 | Rekognition `CompareFaces` (Group 1 image API), first 1M images/month | $0.00125 per image | [Rekognition pricing](https://aws.amazon.com/rekognition/pricing/), AWS Price List API `APS3-Group1-ImagesProcessed` |
| P2 | Polly neural voices | $16.00 per 1M characters | [Polly pricing](https://aws.amazon.com/polly/pricing/) |
| P3 | Groq `whisper-large-v3-turbo` | $0.04 per hour of audio | [Groq model page](https://console.groq.com/docs/model/whisper-large-v3-turbo) |
| P4 | Groq `openai/gpt-oss-120b` | $0.15 per 1M input tokens, $0.60 per 1M output tokens | [Groq model page](https://console.groq.com/docs/model/openai/gpt-oss-120b) |
| P5 | Lambda (x86) | $0.0000166667 per GB-second, $0.20 per 1M requests | [Lambda pricing](https://aws.amazon.com/lambda/pricing/), AWS Price List API |
| P6 | API Gateway REST API, first 333M requests | $3.50 per 1M requests | [API Gateway pricing](https://aws.amazon.com/api-gateway/pricing/), AWS Price List API |
| P7 | DynamoDB on-demand | $0.71 per 1M write units, $0.1425 per 1M read units | [DynamoDB pricing](https://aws.amazon.com/dynamodb/pricing/on-demand/), AWS Price List API |
| P8 | WhatsApp: non-template replies, and utility templates, sent inside the 24-hour customer service window are free (per-message pricing since 1 Jul 2025) | $0 | [Meta WhatsApp pricing](https://developers.facebook.com/docs/whatsapp/pricing/) |

## Cost per check-in: working

One check-in is a selfie, a location and a voice note, and the bot sends a spoken result reply.

| Item | Assumption | Cost (USD) |
|---|---|---|
| Face match (P1) | 1 `CompareFaces` call | 0.00125 |
| Spoken replies (P2) | About 250 characters spoken (voice prompt plus result) | 0.00400 |
| Speech-to-text (P3) | 15-second voice note | 0.00017 |
| Voice check (P4) | Upper bound: 600 input tokens, 800 output tokens (the `max_tokens` cap, including reasoning) | 0.00057 |
| Lambda (P5) | Estimate: 15 invocations (webhooks and WhatsApp status callbacks), 10 GB-seconds in total at 512 MB | 0.00017 |
| API Gateway (P6) | 15 requests | 0.00005 |
| DynamoDB (P7) | Estimate: 20 writes, 40 reads | 0.00002 |
| WhatsApp (P8) | The worker starts the conversation, so every reply is inside the service window | 0 |
| **Total** | | **≈ 0.0062** |

- **Per worker per month:** 22 working days × $0.0062 ≈ **$0.14**.
- **For 10,000 workers:** ≈ **$1,370 per month**.
- **Kannada workers:** Polly has no Kannada voice, so they get text replies only. Without spoken replies a check-in costs about **$0.0022**.
- **Largest item:** spoken replies are about 65% of the cost. Caching the fixed phrases would cut most of it.

**Not included:**

- S3 storage: about 180 KB of media per check-in.
- CloudWatch logs.
- One-time onboarding: Textract on the Aadhaar photo and Rekognition `IndexFaces`.
- Reminder templates sent outside the service window; those are paid utility messages.

## SDG mapping

The [UN Sustainable Development Goals](https://sdgs.un.org/goals) cited in the README: SDG 1 (No Poverty), SDG 8 (Decent Work and Economic Growth), SDG 10 (Reduced Inequalities) and SDG 16 (Peace, Justice and Strong Institutions).
