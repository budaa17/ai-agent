/**
 * Free-text evening reports the way a site supervisor actually types them:
 * abbreviations, mixed units, Cyrillic and Latin in one line, numbers written
 * as words, and the occasional missing field. A1 has to turn these into a
 * structured draft, so the messy ones matter more than the tidy ones.
 *
 * `expected` records what a correct extraction should produce — use it to score
 * the agent rather than eyeballing the output.
 */

export type DailyReportSample = {
  readonly slug: string;
  /** What the supervisor typed. */
  readonly text: string;
  readonly expected: {
    readonly workCode: string | null;
    readonly quantity: number | null;
    readonly unit: string | null;
    readonly workerCount: number | null;
    readonly hoursPerWorker: number | null;
    readonly blocker: string | null;
    /** Why this sample is in the set. */
    readonly tests: string;
  };
};

export const MONGOLIAN_DAILY_REPORTS: readonly DailyReportSample[] = [
  {
    slug: "engiin-tailan",
    text: "Өнөөдөр 7-р давхрын баганын бетон 18.4 куб цутгав. 7 хүн 8 цаг ажиллав. Асуудалгүй.",
    expected: {
      workCode: "CN-02",
      quantity: 18.4,
      unit: "м3",
      workerCount: 7,
      hoursPerWorker: 8,
      blocker: null,
      tests: "Суурь тохиолдол — бүх талбар тодорхой",
    },
  },
  {
    slug: "toon-useger",
    text: "Хананы өрлөг хорин таван квадрат хийсэн. Таван хүн бүтэн өдөр ажиллав.",
    expected: {
      workCode: "MS-01",
      quantity: 25,
      unit: "м2",
      workerCount: 5,
      hoursPerWorker: 8,
      blocker: null,
      tests: "Тоог үсгээр бичсэн, «бүтэн өдөр» = 8 цаг",
    },
  },
  {
    slug: "toviloltei",
    text: "RB-01 арматур 0.72 тн угсрав, 6 хүн 8ц. Материал хүрэлцэв.",
    expected: {
      workCode: "RB-01",
      quantity: 0.72,
      unit: "тн",
      workerCount: 6,
      hoursPerWorker: 8,
      blocker: null,
      tests: "Ажлын код шууд бичсэн, «8ц» товчлол",
    },
  },
  {
    slug: "saadtai-boroo",
    text: "Үдээс хойш бороо орсон тул өндөрлөгийн ажил зогсов. Зөвхөн 6 куб бетон цутгаж амжив. 7 хүн 4 цаг л ажиллалаа.",
    expected: {
      workCode: "CN-02",
      quantity: 6,
      unit: "м3",
      workerCount: 7,
      hoursPerWorker: 4,
      blocker: "Цаг агаар",
      tests: "Саад илрүүлэх, хагас өдөр",
    },
  },
  {
    slug: "material-duussan",
    text: "Блок дууссан учир өрлөг өглөө 10 цагт зогссон. 12 м2 хийсэн. 5 хүн 3 цаг.",
    expected: {
      workCode: "MS-01",
      quantity: 12,
      unit: "м2",
      workerCount: 5,
      hoursPerWorker: 3,
      blocker: "Материал дууссан",
      tests: "Материалын саад",
    },
  },
  {
    slug: "holimog-useg",
    text: "Beton C30 22 m3 tsutgav. 8 hun 8 tsag ajillav. Kran ajillaagui 2 tsag.",
    expected: {
      workCode: "CN-02",
      quantity: 22,
      unit: "м3",
      workerCount: 8,
      hoursPerWorker: 8,
      blocker: "Техник ажиллаагүй",
      tests: "Латинаар бичсэн монгол — кириллд хөрвүүлэх шаардлагатай",
    },
  },
  {
    slug: "hoyor-ajil",
    text: "Өнөөдөр хоёр ажил хийсэн: арматур 0.5 тн, бетон 15 куб. Нийт 12 хүн 8 цаг.",
    expected: {
      workCode: "RB-01",
      quantity: 0.5,
      unit: "тн",
      workerCount: 12,
      hoursPerWorker: 8,
      blocker: null,
      tests: "Нэг тайланд хоёр ажлын мөр — хоёуланг нь салгах ёстой",
    },
  },
  {
    slug: "hemjee-duttai",
    text: "Өрлөгийн ажил үргэлжлэв. 5 хүн ажиллав.",
    expected: {
      workCode: "MS-01",
      quantity: null,
      unit: null,
      workerCount: 5,
      hoursPerWorker: null,
      blocker: null,
      tests: "Тоо хэмжээ дутуу — агент таамаглахгүй, асуулт үүсгэх ёстой",
    },
  },
  {
    slug: "material-nertei",
    text: "Керамзитбетон блокоор 30 м2 хана өрөв, 380 ширхэг блок зарцуулав. 5 хүн 8 цаг.",
    expected: {
      workCode: "MS-01",
      quantity: 30,
      unit: "м2",
      workerCount: 5,
      hoursPerWorker: 8,
      blocker: null,
      tests: "Материалын нэрийг каталогийн код руу буулгах (MAT-BLK-390)",
    },
  },
  {
    slug: "urt-tailbar",
    text:
      "Өглөө 8 цагт ажил эхэлсэн. Эхлээд өмнөх өдрийн ажлыг шалгаж, дараа нь 7-р давхрын " +
      "багана руу шилжсэн. Бетон машин 10:30-д ирсэн. Нийт 20 шоо метр бетон цутгасан. " +
      "Ажилчид 8 хүн, 8 цаг ажиллав. Тоног төхөөрөмж хэвийн. Аюулгүй ажиллагааны " +
      "зааварчилгааг өглөө өгсөн. Маргааш 8-р давхрын арматур эхэлнэ.",
    expected: {
      workCode: "CN-02",
      quantity: 20,
      unit: "м3",
      workerCount: 8,
      hoursPerWorker: 8,
      blocker: null,
      tests: "Урт тайлбараас гол тоог салгаж авах",
    },
  },
];
