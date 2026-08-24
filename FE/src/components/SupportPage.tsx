import React from 'react';
import { ArrowLeft, CheckCircle2, Heart, LockKeyhole, Server, ShieldCheck, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { SUPPORT_CONFIG } from '../config/support';
import { SupportPaymentPanel } from './SupportPaymentPanel';

const uses = [
  { icon: Server, title: 'Hạ tầng ổn định', text: 'Máy chủ, tên miền, sao lưu và giám sát để ứng dụng luôn sẵn sàng.' },
  { icon: Sparkles, title: 'Chi phí tạo truyện', text: 'API và mô hình AI phục vụ việc tạo những câu chuyện mới.' },
  { icon: ShieldCheck, title: 'Nội dung an toàn', text: 'Kiểm thử, kiểm duyệt và cải thiện chất lượng nội dung phù hợp với trẻ.' },
  { icon: LockKeyhole, title: 'Bảo mật và riêng tư', text: 'Bảo trì, vá lỗi và bảo vệ dữ liệu của gia đình sử dụng ứng dụng.' },
];

export default function SupportPage() {
  return (
    <div className="min-h-screen bg-slate-950 px-4 py-6 text-slate-100 sm:py-10">
      <main className="mx-auto max-w-5xl">
        <Link
          to="/"
          className="mb-7 inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-slate-300 transition-colors hover:bg-white/5 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Về trang kể chuyện
        </Link>

        <div className="grid items-start gap-8 lg:grid-cols-[1fr_420px]">
          <section className="space-y-7">
            <div className="space-y-3">
              <span className="inline-flex items-center gap-2 rounded-full border border-rose-400/20 bg-rose-400/10 px-3 py-1 text-xs font-bold text-rose-200">
                <Heart className="h-3.5 w-3.5 fill-rose-300" />
                Ủng hộ vận hành dự án
              </span>
              <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
                Giúp những câu chuyện tiếp tục được kể
              </h1>
              <p className="max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">
                Bedtime Story Companion đang được duy trì miễn phí. Nếu dự án hữu ích với gia đình mình,
                ba mẹ có thể ủng hộ tùy tâm để cùng trang trải chi phí vận hành và cải thiện trải nghiệm kể chuyện cho trẻ.
              </p>
            </div>

            <div>
              <h2 className="mb-4 text-xl font-extrabold">Khoản ủng hộ được ưu tiên cho</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {uses.map(({ icon: Icon, title, text }) => (
                  <article key={title} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                    <Icon className="mb-3 h-5 w-5 text-amber-300" />
                    <h3 className="font-bold text-slate-100">{title}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-slate-300">{text}</p>
                  </article>
                ))}
              </div>
            </div>

            <section className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5 sm:p-6">
              <h2 className="text-lg font-extrabold">Nguyên tắc minh bạch</h2>
              <ul className="mt-4 space-y-3 text-sm leading-relaxed text-slate-300">
                {[
                  'Ủng hộ hoàn toàn tự nguyện, không phải điều kiện để tạo truyện và không mở khóa quyền lợi đặc biệt.',
                  'Đây là khoản hỗ trợ chi phí vận hành dự án, không phải hoạt động vận động từ thiện.',
                  'Dự án không tự truy cập giao dịch ngân hàng và không công khai danh tính người chuyển tiền.',
                  'Số liệu thu, chi chỉ được công bố ở dạng tổng hợp; chứng từ vận hành được lưu để đối chiếu khi cần.',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2.5">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5 text-sm text-slate-300 sm:p-6">
              <h2 className="text-lg font-extrabold text-slate-100">Thông tin đơn vị tiếp nhận</h2>
              <dl className="mt-4 grid gap-3 sm:grid-cols-[150px_1fr]">
                <dt className="text-slate-400">Chủ dự án</dt><dd className="font-semibold text-slate-100">{SUPPORT_CONFIG.operatorName}</dd>
                <dt className="text-slate-400">Hình thức</dt><dd>{SUPPORT_CONFIG.operatorType}</dd>
                <dt className="text-slate-400">Mã số thuế</dt><dd className="font-mono">{SUPPORT_CONFIG.taxCode}</dd>
                <dt className="text-slate-400">Liên hệ</dt>
                <dd><a href={`mailto:${SUPPORT_CONFIG.contactEmail}`} className="text-indigo-300 hover:underline">{SUPPORT_CONFIG.contactEmail}</a></dd>
              </dl>
            </section>

            <p className="text-xs leading-relaxed text-slate-400">
              Khi phần mã QR được hiển thị, trình duyệt tải ảnh từ VietQR. Không đưa tên bé, hồ sơ hoặc nội dung phản hồi vào nội dung chuyển khoản.
            </p>
          </section>

          <aside className="rounded-3xl border border-slate-700 bg-slate-900 p-5 shadow-2xl shadow-black/20 lg:sticky lg:top-6">
            <h2 className="mb-1 text-center text-xl font-extrabold">Ủng hộ tùy tâm</h2>
            <p className="mb-5 text-center text-xs leading-relaxed text-slate-300">
              Mã không điền sẵn số tiền; ba mẹ tự chọn trong ứng dụng ngân hàng.
            </p>
            <SupportPaymentPanel isNightMode />
            <a
              href={`mailto:${SUPPORT_CONFIG.contactEmail}`}
              className="mt-4 block text-center text-xs text-slate-400 hover:text-slate-200 hover:underline"
            >
              Báo chuyển nhầm: {SUPPORT_CONFIG.contactEmail}
            </a>
          </aside>
        </div>
      </main>
    </div>
  );
}
