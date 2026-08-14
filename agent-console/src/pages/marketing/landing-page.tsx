import {
  Boxes,
  CalendarCheck,
  ClipboardList,
  FileSearch,
  Gauge,
  ShieldCheck,
  Users,
} from "lucide-react";
import { Link } from "react-router-dom";
import { annualSaving, describeLimit, formatMinorAmount, priceFor } from "../../api/public-billing";
import {
  BorderBeam,
  ConstructionScene,
  CursorGlow,
  MagneticLink,
  ProductConsole,
  Reveal,
  SpotlightCard,
  WorkflowBeam,
} from "./landing-effects";
import "./landing-page.css";
import { softwareApplicationSchema, useDocumentMeta } from "./use-document-meta";
import { usePublicPlans } from "./use-public-plans";

/**
 * Public landing page (landing-page-roadmap.md §10, §12, §14).
 *
 * The cinematic visual layer is decorative. Product claims, prices and limits
 * remain owned by the current BuildWatch contracts: AI prepares a draft, an
 * authorized engineer approves, and the public plan API owns every amount.
 */

const PROBLEMS = [
  ["Төслийн менежер", "Бодит явц, төсөв, хуваарийг гараар тулгаж, эрсдэлийг оройтож хардаг."],
  ["Талбайн инженер", "Нэг мэдээллийг тайлан, хүснэгт, чатад хэд хэдэн удаа дахин шивдэг."],
  ["Удирдлага", "Нэгдсэн нотолгоо байхгүйгээс асуудал гарсны дараа л шалтгааныг хайдаг."],
] as const;

const STEPS = [
  {
    icon: ClipboardList,
    title: "Төлөвлө",
    body: "Зураг төслөөс тоо хэмжээ, төсөв, хуваарийн baseline-ийг бэлдэнэ. Масштаб баталгаажаагүй зурагнаас тоо гаргахгүй.",
  },
  {
    icon: FileSearch,
    title: "Бүртгэ",
    body: "Талбайн чөлөөт бичвэр, зураг, материалын хөдөлгөөнийг бүтэцтэй өдрийн тайлан болгоно.",
  },
  {
    icon: CalendarCheck,
    title: "Баталгаажуул",
    body: "Тайлан, фото, хэмжилт, материалын хөдөлгөөнийг хооронд нь тулгаж гүйцэтгэлийг шалгана.",
  },
  {
    icon: Gauge,
    title: "Шийд",
    body: "Одоогийн хурдаар хугацаанд амжих эсэхийг тооцоолж, эрсдэл ба засах саналыг гаргана.",
  },
] as const;

const ROLES = [
  {
    icon: Users,
    role: "Төслийн менежер",
    outcome: "Явц, төсөв, хуваарийг гараар тулгахаа болино.",
  },
  {
    icon: ClipboardList,
    role: "Талбайн инженер",
    outcome: "Нэг мэдээллийг дахин дахин шивэхгүй.",
  },
  {
    icon: ShieldCheck,
    role: "Хянагч",
    outcome: "Юуг яагаад баталсан нь мөрөөрөө хадгалагдана.",
  },
  {
    icon: Boxes,
    role: "Удирдлага",
    outcome: "Эрсдэлийг үүссэний дараа биш, өнөөдөр харна.",
  },
] as const;

const AGENTS = [
  {
    code: "A0",
    title: "Зураг төсөл ба урьдчилсан тооцоо",
    does: "PDF, XLSX болон зураг төслийн эх файлаас metadata, элемент, тоо хэмжээний ноорог, WBS холболт санал болгоно.",
    doesNot: "Масштаб ба эх сурвалж баталгаажаагүй үед тоо зохиохгүй, албан ёсны төсөв батлахгүй.",
  },
  {
    code: "A1",
    title: "Өдөр тутмын бүртгэл",
    does: "Талбайн бичвэрийг бүтэцтэй тайлан болгож, зөрүүтэй талбарыг хяналтад оруулна.",
    doesNot: "Дутуу мэдээллийг таамаглахгүй — асуулт үүсгэнэ.",
  },
  {
    code: "A2",
    title: "Гүйцэтгэл баталгаажуулалт",
    does: "Тайлан, фото, материалын хөдөлгөөний нийцлийг шалгаж зөрүүг тодруулна.",
    doesNot: "Фото дангаараа гүйцэтгэл гэж хүлээн авахгүй.",
  },
  {
    code: "A3",
    title: "Тайлан",
    does: "Өдөр, долоо хоног, сарын тайланг эх сурвалжийн холбоостойгоор бэлдэнэ.",
    doesNot: "Тоог өөрөө зохиохгүй — детерминистик тооцооллоос авна.",
  },
  {
    code: "A4",
    title: "Лавлагаа туслах",
    does: "Төслийн бодит өгөгдөл дээр тулгуурлан асуултад хариулна.",
    doesNot: "Мэдээлэл хүрэлцэхгүй бол таамаглалгүйгээр шууд хэлнэ.",
  },
  {
    code: "A5",
    title: "Оркестрац",
    does: "Агентуудын дарааллыг детерминистик байдлаар удирдаж, хүний баталгааг хүлээнэ.",
    doesNot: "Хүний оронд шийдвэр батлахгүй.",
  },
] as const;

const TRUST = [
  [
    "Байгууллага бүр тусгаарлагдсан",
    "Tenant, project, object бүрийг server талд шалгана. Өөр байгууллагын өгөгдөлд prompt эсвэл client ID-аар нэвтрэх боломжгүй.",
  ],
  [
    "Өөрчлөлт бүр мөрөөрөө",
    "Зураг, тоо хэмжээ, үнэ, хугацаа, баталгаа, буцаалт бүр хэн, хэзээ, яагаад гэдгээрээ хадгалагдана.",
  ],
  [
    "Тоо LLM-ээс гарахгүй",
    "Тоо хэмжээ, төсөв, critical path, урьдчилсан таамгийг детерминистик service бодно.",
  ],
  [
    "Өгөгдөл танайх",
    "Захиалга дуусахад шинэ өөрчлөлт зогсоно. Өгөгдөл устахгүй, экспортын хугацаа нээлттэй үлдэнэ.",
  ],
] as const;

const ONBOARDING = [
  "Каталог — үнэ, норм, бүтээмж — оруулж, хэрэглэгчийн эрхийг тохируулна.",
  "Зураг төслөөс эхний baseline-ийг инженерийн review-тэй хамт гаргана.",
  "Талбайн өдрийн тайланг системд шилжүүлж, гүйцэтгэлийн нотолгоог холбож эхэлнэ.",
  "Эхний forecast, эрсдэлийн дохио, тайлангийн загварыг байгууллагадаа тааруулна.",
] as const;

const FAQ = [
  {
    question: "Төлбөрөө хийхгүй бол өгөгдөл маань устах уу?",
    answer:
      "Үгүй. Захиалга хаагдвал шинэ өөрчлөлт болон AI ажиллагаа зогсоно, харин өгөгдөл хэвээр үлдэж, 90 хоногийн турш экспортлох боломжтой байна.",
  },
  {
    question: "Хэрэглэгч нэмэх тусам үнэ өсөх үү?",
    answer:
      "Үгүй. Үнэ идэвхтэй төслөөр тогтоогддог. Багцад орсон хэрэглэгчийн тоо нь өсөлтөөс сэргийлэх хязгаар болохоос мөнгө авах зорилготой биш.",
  },
  {
    question: "НӨАТ орсон уу?",
    answer:
      "Үгүй. Жагсаалтын үнэ НӨАТ ороогүй. Дотоодын хуулийн этгээдэд НӨАТ-тай нэхэмжлэх гаргана.",
  },
  {
    question: "Дансаар төлж болох уу?",
    answer:
      "Тийм. Картын төлбөрөөс гадна гэрээ, банкны шилжүүлгээр төлөх суваг ажилладаг бөгөөд НӨАТ-ын падаан олгоно.",
  },
  {
    question: "Хэзээ ч цуцалж болох уу?",
    answer:
      "Тийм. Цуцлалт хугацааны эцэст хүчинтэй болно — төлсөн хугацаагаа бүрэн ашиглана. Жилийн багцад эхний 14 хоногт бүтэн буцаалт хийнэ.",
  },
] as const;

const SOURCES = [
  "PDF",
  "XLSX",
  "SITE PHOTO",
  "DAILY LOG",
  "BOQ",
  "MATERIAL NORM",
  "PRICE CATALOG",
  "CPM",
] as const;

export function LandingPage() {
  const { catalog, error, loading, slow, retry } = usePublicPlans();
  const plans = catalog?.plans ?? [];

  useDocumentMeta({
    title: "BuildWatch — Өнөөдрийн ажил төлөвлөснөөрөө явж байна уу?",
    description:
      "Зураг төслөөс baseline, талбайн тайлангаас баталгаажсан гүйцэтгэл, тэндээс хугацааны урьдчилсан таамаг. AI ноорог бэлдэнэ, инженер батална.",
    ...(catalog === null
      ? {}
      : {
          structuredData: softwareApplicationSchema({
            offers: plans.flatMap((plan) =>
              plan.prices.map((price) => ({
                name: `${plan.name} · ${price.interval === "YEAR" ? "жил" : "сар"}`,
                priceMinor: price.unitAmountMinor,
                currency: plan.currency,
                interval: price.interval,
              })),
            ),
          }),
        }),
  });

  return (
    <div className="bw-landing">
      <CursorGlow />
      <div aria-hidden="true" className="bw-ambient-noise" />
      <div aria-hidden="true" className="bw-ambient-grid" />

      <section className="bw-section bw-hero" aria-labelledby="landing-title">
        <div className="bw-hero-grid">
          <div className="bw-hero-copy">
            <Reveal delay={60}>
              <p className="bw-eyebrow">
                <i aria-hidden="true" /> Барилгын төслийн AI-agent удирдлагын систем
              </p>
            </Reveal>
            <h1 id="landing-title" className="bw-display-title">
              <span className="sr-only">Өнөөдрийн ажил төлөвлөснөөрөө явсан уу?</span>
              <Reveal as="span" delay={110}>
                <span aria-hidden="true">Өнөөдрийн ажил</span>
              </Reveal>
              <Reveal as="span" delay={180}>
                <span aria-hidden="true" className="outline">
                  Төлөвлөснөөрөө
                </span>
              </Reveal>
              <Reveal as="span" delay={250}>
                <span aria-hidden="true">Явсан уу?</span>
              </Reveal>
            </h1>
            <Reveal delay={320}>
              <p className="bw-hero-intro">
                Зураг төслөөс baseline, талбайн тайлангаас баталгаажсан гүйцэтгэл, тэндээс хугацааны
                урьдчилсан таамаг — нэг урсгалд.{" "}
                <strong>AI ноорог бэлдэнэ, инженер батална.</strong>
              </p>
              <div className="bw-hero-actions">
                <MagneticLink to="/pricing">Багц сонгох</MagneticLink>
                <MagneticLink to="#workflow" variant="ghost">
                  Ажиллах зарчим
                </MagneticLink>
              </div>
            </Reveal>
          </div>

          <Reveal className="bw-hero-visual" delay={160} y={38}>
            <span className="bw-hero-demo-label">Жишээ дүрслэл · бодит төслийн үзүүлэлт биш</span>
            <ConstructionScene />
          </Reveal>
        </div>

        <div className="bw-hero-status" aria-label="BuildWatch үндсэн зарчим">
          <span>Source linked</span>
          <span>Deterministic calculation</span>
          <span>Engineer approval</span>
          <span>Tenant isolated</span>
        </div>
      </section>

      <section className="bw-section bw-problem-section" aria-labelledby="problem-title">
        <div className="bw-section-number" data-label="ӨНӨӨГИЙН БОДИТ БАЙДАЛ">
          01 / АСУУДАЛ
        </div>
        <Reveal>
          <div className="bw-heading-row">
            <h2 id="problem-title" className="bw-section-title">
              ӨГӨГДӨЛ БИЙ.
              <br />
              <span className="outline">НЭГ ҮНЭН АЛГА.</span>
            </h2>
            <p className="bw-section-intro">
              Зураг, төсөв, хуваарь, талбайн тайлан салангид байхад хүн бүр өөр хувилбараар ажиллаж,
              шийдвэрийн хугацаа уртсана.
            </p>
          </div>
        </Reveal>
        <div className="bw-problem-grid">
          {PROBLEMS.map(([title, body], index) => (
            <Reveal key={title} delay={index * 90}>
              <SpotlightCard className="bw-problem-card">
                <span className="bw-card-index">0{index + 1} / BOTTLENECK</span>
                <h3>{title}</h3>
                <p>{body}</p>
              </SpotlightCard>
            </Reveal>
          ))}
        </div>
      </section>

      <section id="workflow" className="bw-workflow-section" aria-labelledby="workflow-title">
        <div className="bw-workflow-inner">
          <div className="bw-section-number" data-label="НЭГ УРСГАЛ · ОЛОН ЭХ СУРВАЛЖ">
            02 / DATA FLOW
          </div>
          <Reveal>
            <div className="bw-heading-row">
              <h2 id="workflow-title" className="bw-section-title">
                ЗУРАГ ОРНО.
                <br />
                <span className="outline">ШИЙДВЭР ГАРНА.</span>
              </h2>
              <p className="bw-section-intro">
                Барилгын өгөгдөл файлуудад салангид хэвтэхээ больж, эх сурвалжийн холбоо ба
                инженерийн баталгаатай pipeline болно.
              </p>
            </div>
          </Reveal>
          <Reveal delay={100}>
            <WorkflowBeam />
          </Reveal>
          <div className="bw-source-marquee" aria-label="BuildWatch-д ашиглах өгөгдлийн төрлүүд">
            <div className="bw-source-track">
              {[...SOURCES, ...SOURCES].map((source, index) => (
                <span key={`${source}-${index}`} aria-hidden={index >= SOURCES.length}>
                  {source}
                  <i>+</i>
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="bw-section bw-role-section" aria-labelledby="principle-title">
        <div className="bw-section-number" data-label="ТӨЛӨВЛӨ · БҮРТГЭ · БАТАЛГААЖУУЛ · ШИЙД">
          03 / АЖИЛЛАХ ЗАРЧИМ
        </div>
        <Reveal>
          <div className="bw-heading-row">
            <h2 id="principle-title" className="bw-section-title">
              RAW DATA-ААС
              <br />
              <span className="outline">CLEAR ACTION.</span>
            </h2>
            <p className="bw-section-intro">
              Dashboard харахаас илүү ажил хийнэ: өгөгдлийг холбож, зөрүүг ил гарган, зөвшөөрөгдсөн
              хүнд дараагийн алхмыг тайлбарлана.
            </p>
          </div>
        </Reveal>

        <div className="bw-role-grid">
          {STEPS.map((step, index) => (
            <Reveal key={step.title} delay={index * 70}>
              <SpotlightCard className="bw-role-card">
                <span className="bw-role-icon">
                  <step.icon aria-hidden size={20} />
                </span>
                <h3>
                  0{index + 1}. {step.title}
                </h3>
                <p>{step.body}</p>
              </SpotlightCard>
            </Reveal>
          ))}
        </div>

        <Reveal delay={120}>
          <ProductConsole />
        </Reveal>
      </section>

      <section className="bw-section bw-role-section" aria-labelledby="roles-title">
        <div className="bw-section-number" data-label="НЭГ SYSTEM · ӨӨР ӨӨР ҮР ДҮН">
          04 / ДҮРЭЭР ҮР ДҮН
        </div>
        <Reveal>
          <div className="bw-heading-row">
            <h2 id="roles-title" className="bw-section-title">
              ХҮН БҮРТ
              <br />
              <span className="outline">ХЭРЭГТЭЙ ХАРАГДАЦ.</span>
            </h2>
            <p className="bw-section-intro">
              Эрх ба ажлын хүрээндээ тохирсон мэдээллийг харна. Нэг байгууллагын өгөгдөл нөгөө
              байгууллагад хэзээ ч холилдохгүй.
            </p>
          </div>
        </Reveal>
        <div className="bw-role-grid">
          {ROLES.map((role, index) => (
            <Reveal key={role.role} delay={index * 70}>
              <SpotlightCard className="bw-role-card">
                <span className="bw-role-icon">
                  <role.icon aria-hidden size={20} />
                </span>
                <h3>{role.role}</h3>
                <p>{role.outcome}</p>
              </SpotlightCard>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="bw-section bw-agent-section" aria-labelledby="agents-title">
        <div className="bw-section-number" data-label="ЧАДАХ ЗҮЙЛ · ХЯЗГААР">
          05 / AI AGENTS
        </div>
        <Reveal>
          <div className="bw-heading-row">
            <h2 id="agents-title" className="bw-section-title">
              AI ЮУ ХИЙХ ВЭ?
              <br />
              <span className="outline">ЮУГ ХИЙХГҮЙ ВЭ?</span>
            </h2>
            <p className="bw-section-intro">
              Тоо хэмжээ, төсөв, critical path, forecast-ийг детерминистик тооцоолол бодно. AI эх
              сурвалжтай draft бэлтгэнэ; эцсийн шийдвэрийг хүн гаргана.
            </p>
          </div>
        </Reveal>
        <div className="bw-agent-grid">
          {AGENTS.map((agent, index) => (
            <Reveal key={agent.code} delay={(index % 3) * 70}>
              <SpotlightCard className="bw-agent-card">
                <span className="bw-agent-code">{agent.code}</span>
                <h3>{agent.title}</h3>
                <p>{agent.does}</p>
                <p className="guardrail">Хязгаар: {agent.doesNot}</p>
              </SpotlightCard>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="bw-manifesto" aria-labelledby="manifesto-title">
        <div className="bw-manifesto-inner">
          <div className="bw-section-number" data-label="BUILDWATCH MANIFESTO">
            06 / PRINCIPLE
          </div>
          <Reveal>
            <h2 id="manifesto-title">
              AI ИНЖЕНЕРИЙГ
              <br />
              ОРЛОХ ЁСГҮЙ.
            </h2>
            <h2 className="dark">
              ТААМАГЛАЛЫГ
              <br />
              АРИЛГАХ ЁСТОЙ.
            </h2>
            <p>
              Production барилгын системд accuracy ганцаараа хангалтгүй. Source, permission,
              version, audit trail, human review бүгд шийдвэрийн нэг хэсэг байх ёстой.
            </p>
          </Reveal>
        </div>
      </section>

      <section className="bw-section bw-trust-section" aria-labelledby="trust-title">
        <div className="bw-section-number" data-label="SOURCE · ROLE · VERSION · REVIEW">
          07 / TRUST LAYER
        </div>
        <Reveal>
          <div className="bw-heading-row">
            <h2 id="trust-title" className="bw-section-title">
              ИТГЭЛ НЬ
              <br />
              <span className="outline">ТОХИРГОО БИШ.</span>
            </h2>
            <p className="bw-section-intro">
              AI юу уншсан, ямар хувилбар ашигласан, хэн баталсан гэдгийг мөр бүрээр нь үлдээнэ.
            </p>
          </div>
        </Reveal>
        <div className="bw-trust-grid">
          {TRUST.map(([title, body], index) => (
            <Reveal key={title} delay={index * 70}>
              <SpotlightCard className="bw-trust-card">
                <span>0{index + 1} / CONTROL</span>
                <h3>{title}</h3>
                <p>{body}</p>
              </SpotlightCard>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="bw-section bw-onboarding" aria-labelledby="onboarding-title">
        <div className="bw-section-number" data-label="ТОХИРГООНООС ЭХНИЙ FORECAST ХҮРТЭЛ">
          08 / ЭХНИЙ 30 ХОНОГ
        </div>
        <Reveal>
          <div className="bw-heading-row">
            <h2 id="onboarding-title" className="bw-section-title">
              БАГЦ АВСНААР
              <br />
              <span className="outline">ЮУ БОЛОХ ВЭ?</span>
            </h2>
            <p className="bw-section-intro">
              Subscription бол зөвхөн нэвтрэх эрх биш. Эхний сарын турш өгөгдөл, baseline, талбайн
              бүртгэл, тайлангийн урсгалыг дарааллаар нь тохируулна.
            </p>
          </div>
        </Reveal>
        <ol className="bw-onboarding-list">
          {ONBOARDING.map((item, index) => (
            <li key={item}>
              <span>0{index + 1}</span>
              <p>{item}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="bw-pricing" aria-labelledby="pricing">
        <div className="bw-pricing-inner">
          <div className="bw-section-number" data-label="API-ААС ИРСЭН БОДИТ ҮНЭ БА ЛИМИТ">
            09 / SUBSCRIPTION
          </div>
          <Reveal>
            <div className="bw-heading-row">
              <h2 id="pricing" className="bw-section-title">
                ХЭРЭГЛЭГЧЭЭР БИШ.
                <br />
                <span className="outline">ТӨСЛӨӨР.</span>
              </h2>
              <div>
                <p className="bw-section-intro">
                  Нуугдмал төлбөргүй. НӨАТ ороогүй жагсаалтын үнэ. Жилийн төлөлт сонговол хэмнэлтийг
                  систем бодож харуулна.
                </p>
                <p className="bw-pricing-note">
                  <span>Дотоодын нэхэмжлэх</span>
                  <span>НӨАТ-ын падаан</span>
                  <span>Өгөгдлийн экспорт</span>
                </p>
              </div>
            </div>
          </Reveal>

          {loading && (
            <p className="bw-catalog-loading" role="status">
              Багцын бодит мэдээллийг ачаалж байна…
              {slow && " Сервер идэвхжиж байгаа тул анхны ачаалалт нэг минут орчим байж болно."}
            </p>
          )}
          {error !== null && (
            <div role="alert" className="bw-catalog-error">
              <p>{error}. Үнэ зохиож харуулахгүй.</p>
              <button type="button" onClick={retry}>
                Дахин оролдох
              </button>
            </div>
          )}

          <div className="bw-plan-grid">
            {plans.map((plan, index) => {
              const monthly = priceFor(plan, "MONTH");
              const yearly = priceFor(plan, "YEAR");
              const saving = annualSaving(plan);
              const recommended = plan.code.toLowerCase() === "business";
              const signupInterval = yearly === null ? "MONTH" : "YEAR";
              return (
                <Reveal key={plan.code} delay={index * 80}>
                  <SpotlightCard className={`bw-plan-card ${recommended ? "is-recommended" : ""}`}>
                    {recommended && <BorderBeam />}
                    <div className="bw-plan-topline">
                      <span>0{index + 1} / PLAN</span>
                      {recommended && (
                        <span className="bw-recommended-label">Санал болгож буй</span>
                      )}
                    </div>
                    <h3>{plan.name}</h3>
                    <p className="bw-plan-description">{plan.description}</p>
                    <p className="bw-plan-price">
                      {monthly === null ? "—" : formatMinorAmount(monthly, plan.currency)}
                      <small>/сар</small>
                    </p>
                    <p className="bw-yearly-price">
                      {yearly === null ? (
                        "Жилийн үнэ тохируулаагүй"
                      ) : (
                        <>
                          Жилээр {formatMinorAmount(yearly, plan.currency)}
                          {saving !== null && (
                            <strong> · {formatMinorAmount(saving, plan.currency)} хэмнэнэ</strong>
                          )}
                        </>
                      )}
                    </p>
                    <ul className="bw-plan-limits">
                      <li>{describeLimit(plan, "PROJECT_ACTIVE_MAX")} идэвхтэй төсөл</li>
                      <li>{describeLimit(plan, "USER_ACTIVE_MAX")} хэрэглэгч</li>
                      <li>Сард {describeLimit(plan, "AI_MONTHLY_RUNS_INCLUDED")} AI ажиллагаа</li>
                    </ul>
                    <MagneticLink
                      to={`/company-signup?plan=${encodeURIComponent(plan.code)}&interval=${signupInterval}`}
                    >
                      {plan.name} сонгох
                    </MagneticLink>
                  </SpotlightCard>
                </Reveal>
              );
            })}

            <Reveal delay={plans.length * 80}>
              <SpotlightCard className="bw-plan-card bw-enterprise-card">
                <div className="bw-plan-topline">
                  <span>0{plans.length + 1} / PLAN</span>
                </div>
                <h3>Enterprise</h3>
                <p className="bw-plan-description">Групп компани, SSO, SLA, гэрээт нэхэмжлэх.</p>
                <p className="bw-plan-price">Гэрээт</p>
                <p className="bw-yearly-price">Хэрэгцээ ба нэвтрүүлэлтийн хүрээнд тохируулна.</p>
                <ul className="bw-plan-limits">
                  <li>Хэрэгцээнд тохирсон хязгаар</li>
                  <li>Нэрлэсэн менежер</li>
                  <li>Гэрээт нэхэмжлэх</li>
                </ul>
                <MagneticLink to="/contact" variant="ghost">
                  Холбоо барих
                </MagneticLink>
              </SpotlightCard>
            </Reveal>
          </div>

          <div className="bw-pricing-footer">
            <span>Сар/жил, storage, audit, API боломжийн бүх ялгааг нэг дор харна.</span>
            <Link to="/pricing" className="bw-inline-link">
              Багцын бүрэн харьцуулалт →
            </Link>
          </div>
        </div>
      </section>

      <section className="bw-section bw-faq" aria-labelledby="faq-title">
        <div className="bw-section-number" data-label="ТӨЛБӨР · ӨГӨГДӨЛ · ЦУЦЛАЛТ">
          10 / ТҮГЭЭМЭЛ АСУУЛТ
        </div>
        <Reveal>
          <div className="bw-heading-row">
            <h2 id="faq-title" className="bw-section-title">
              АСУУХ ЗҮЙ
              <br />
              <span className="outline">ҮЛДЭХ ЁСГҮЙ.</span>
            </h2>
            <p className="bw-section-intro">
              Захиалга, НӨАТ, хэрэглэгчийн лимит, өгөгдлийн эзэмшил, цуцлалтын үндсэн нөхцөл.
            </p>
          </div>
        </Reveal>
        <div className="bw-faq-list">
          {FAQ.map((item) => (
            <details key={item.question}>
              <summary>{item.question}</summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="bw-section bw-final-cta" aria-labelledby="final-cta-title">
        <Reveal>
          <p className="bw-micro-label">ЗУРАГ ТӨСЛӨӨС ӨДӨР ТУТМЫН ШИЙДВЭР ХҮРТЭЛ</p>
          <h2 id="final-cta-title">
            ТӨСЛӨӨ
            <br />
            <span>ТААМАГЛАЛГҮЙ УДИРД.</span>
          </h2>
          <p>
            Багцаа сонгосны дараа email баталгаажуулалт, hosted checkout, төлбөрийн webhook
            баталгаажсаны дараа л байгууллагын workspace идэвхжинэ.
          </p>
          <div className="bw-final-actions">
            <MagneticLink to="/pricing">Багц сонгох</MagneticLink>
            <MagneticLink to="/features" variant="ghost">
              Боломжуудыг үзэх
            </MagneticLink>
          </div>
        </Reveal>
      </section>
    </div>
  );
}
