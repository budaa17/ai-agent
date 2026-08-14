import type { BuildWatchApiError } from "../api/client";

export type FriendlyError = {
  readonly title: string;
  readonly message: string;
  /** True when reloading the screen is what actually resolves it. */
  readonly reloadable: boolean;
};

/**
 * Turns backend error codes into something a site supervisor or manager can act
 * on. The raw codes are precise but useless at the moment of failure: seeing
 * `OPTIMISTIC_LOCK_CONFLICT` tells nobody that a colleague edited the same row
 * a second earlier and the fix is simply to reload.
 */
/**
 * Shape check rather than `instanceof`. The class identity does not survive
 * every module boundary — a mocked client, a duplicated bundle — and an error
 * translator that throws is worse than one that degrades.
 */
function isApiError(error: unknown): error is BuildWatchApiError {
  return (
    error instanceof Error &&
    typeof (error as Partial<BuildWatchApiError>).code === "string" &&
    typeof (error as Partial<BuildWatchApiError>).status === "number"
  );
}

export function friendlyError(error: unknown): FriendlyError {
  if (!isApiError(error)) {
    return {
      title: "Алдаа гарлаа",
      message: error instanceof Error ? error.message : String(error),
      reloadable: false,
    };
  }

  switch (error.code) {
    case "OPTIMISTIC_LOCK_CONFLICT":
      return {
        title: "Өөр хүн энэ хооронд өөрчилсөн",
        message:
          "Таны нээснээс хойш өөр хэрэглэгч энэ бичлэгийг шинэчилжээ. Хамгийн сүүлийн хувилбарыг ачаалаад дахин шийдвэрлэнэ үү.",
        reloadable: true,
      };
    case "IDEMPOTENCY_CONFLICT":
      return {
        title: "Энэ үйлдэл аль хэдийн бүртгэгдсэн",
        message:
          "Ижил түлхүүрээр өөр агуулгатай хүсэлт илгээгдсэн байна. Дэлгэцээ шинэчилж, юу хадгалагдсаныг шалгана уу.",
        reloadable: true,
      };
    case "REVIEW_NOT_APPROVED":
      if (error.details !== null && typeof error.details?.dependencyId === "string") {
        return {
          title: "Өмнөх шат батлагдаагүй байна",
          message:
            "Тоо хэмжээ, төсөв, хуваарийн холбогдох хувилбаруудыг дарааллаар баталсны дараа энэ алхмыг гүйцэтгэнэ.",
          reloadable: true,
        };
      }
      return {
        title: "Энэ даалгавар хянагдах төлөвт байхаа больжээ",
        message: "Хэн нэгэн аль хэдийн шийдвэрлэсэн байж магадгүй. Жагсаалтаа шинэчилнэ үү.",
        reloadable: true,
      };
    case "AUTH_FORBIDDEN":
      return {
        title: "Танд энэ үйлдлийн эрх байхгүй",
        message:
          "Даалгавар өөр үүрэгт оногдсон, эсвэл өөрийн үүсгэсэн зүйлээ батлах гэж байна (four-eyes дүрэм).",
        reloadable: false,
      };
    case "PROJECT_NOT_FOUND":
      return {
        title: "Төсөл олдсонгүй",
        message: "Энэ төсөл байхгүй эсвэл танд хандах эрх байхгүй байна.",
        reloadable: false,
      };
    case "INVITATION_INVALID":
      return {
        title: "Урилга хүчингүй байна",
        message:
          "Токен буруу, эсвэл энэ урилгыг аль хэдийн ашигласан байна. Урилга нэг л удаа ажилладаг — админаас шинээр авна уу.",
        reloadable: false,
      };
    case "INVITATION_EXPIRED":
      return {
        title: "Урилгын хугацаа дууссан",
        message: "Энэ урилга хүчинтэй хугацаа нь дуусжээ. Админаас шинэ урилга хүсэлт гаргана уу.",
        reloadable: false,
      };
    case "VALIDATION_FAILED":
      return {
        title: "Мэдээлэл бүрэн бус байна",
        message: error.message,
        reloadable: false,
      };
    case "ARTIFACT_ACCESS_DENIED":
      return {
        title: "Файлын холбоос хүчингүй боллоо",
        message: "Богино настай холбоосын хугацаа дууссан байна. Дахин нээнэ үү.",
        reloadable: true,
      };
    // Subscription boundary. These arrive as HTTP 402 and never resolve by
    // reloading — the company has to act on billing or on its plan.
    case "TENANT_SUBSCRIPTION_REQUIRED":
      return {
        title: "Идэвхтэй захиалга шаардлагатай",
        message:
          "Энэ ажлын талбарт багц идэвхжээгүй байна. Компанийн администратор багцаа сонгож төлбөрөө баталгаажуулсны дараа нээгдэнэ.",
        reloadable: false,
      };
    case "TENANT_ACCESS_SUSPENDED":
      return {
        title: "Захиалга түр хаагдсан",
        message:
          "Төлбөр хийгдээгүй тул шинэ өөрчлөлт хийх боломжгүй байна. Өгөгдөл хэвээр хадгалагдсан — администратор төлбөрөө сэргээмэгц үргэлжлүүлнэ.",
        reloadable: false,
      };
    case "FEATURE_NOT_INCLUDED":
      return {
        title: "Энэ боломж таны багцад ороогүй",
        message: "Багцаа ахиулснаар энэ боломж нээгдэнэ.",
        reloadable: false,
      };
    case "PROJECT_LIMIT_REACHED":
      return {
        title: "Идэвхтэй төслийн хязгаарт хүрсэн",
        message:
          "Багцад орсон идэвхтэй төслийн тоо дүүрсэн байна. Дууссан төслөө хаах эсвэл багцаа ахиулна уу.",
        reloadable: false,
      };
    case "USER_LIMIT_REACHED":
      return {
        title: "Хэрэглэгчийн хязгаарт хүрсэн",
        message:
          "Багцад орсон хэрэглэгчийн тоо дүүрсэн байна. Идэвхгүй хэрэглэгчийг хасах эсвэл багцаа ахиулна уу.",
        reloadable: false,
      };
    case "STORAGE_LIMIT_REACHED":
      return {
        title: "Хадгалах багтаамж дүүрсэн",
        message: "Хуучин файл цэвэрлэх эсвэл нэмэлт багтаамж авснаар үргэлжлүүлнэ.",
        reloadable: false,
      };
    case "AI_USAGE_LIMIT_REACHED":
      return {
        title: "Сарын AI ажиллагаа дууссан",
        message:
          "Багцад орсон AI ажиллагааны тоо дүүрсэн байна. Аль хэдийн ажиллаж буй зүйл үргэлжилнэ; нэмэлт багц авах эсвэл дараа сарыг хүлээнэ үү.",
        reloadable: false,
      };
    default:
      return {
        title: error.status >= 500 ? "Сервер хариу өгсөнгүй" : "Хүсэлт амжилтгүй боллоо",
        message: error.message,
        reloadable: error.status >= 500,
      };
  }
}
