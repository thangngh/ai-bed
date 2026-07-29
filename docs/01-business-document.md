# Business Document — Bedtime Story Companion

> **Trạng thái:** MVP Planning  
> **Version:** 1.0  
> **Ngày:** 2026-07-27

---

## 1. Vision

Trở thành **người bạn kể chuyện trước giờ ngủ thông minh** dành cho trẻ em 3-6 tuổi, nơi cha mẹ có thể tạo ra những câu chuyện được cá nhân hóa, giàu tính giáo dục và an toàn tuyệt đối — mà không cần kỹ năng công nghệ.

## 2. Sứ mệnh MVP

Xây dựng **core engine có kỷ luật** giúp:
- Kiểm chứng phụ huynh có dùng được không
- Đảm bảo truyện tạo ra ổn định, chất lượng
- Flow đủ mượt để test thật
- Hệ thống đủ an toàn để đưa cho user test

## 3. Target Users

### Primary: Phụ huynh (25–40 tuổi)
- Có con nhỏ 3–6 tuổi
- Quan tâm giáo dục sớm
- Muốn kể chuyện nhưng hết ý tưởng
- Ngại nội dung AI vì sợ thiếu kiểm soát

### Secondary: Trẻ em (3–6 tuổi)
- Lắng nghe câu chuyện
- Tương tác tại các điểm dừng
- Học bài học nhẹ nhàng qua nội dung

## 4. Value Proposition

| Vấn đề | Giải pháp |
|---|---|
| Hết ý tưởng kể chuyện mỗi tối | AI sinh truyện theo chủ đề cha mẹ chọn |
| Lo nội dung AI không phù hợp | Rule-based safety + 3-stage review pipeline |
| Con không tập trung | Story có 2-3 điểm tương tác |
| Mỗi lần kể không nhớ đã kể gì | Memory system lưu lịch sử, sở thích |
| Nhập đi nhập lại thông tin | Child profile + persistent memory |

## 5. User Personas MVP

### Persona 1: Chị Minh (32 tuổi)
- **Nghề nghiệp:** Nhân viên văn phòng
- **Con:** Bé An, 4 tuổi
- **Pain point:** Tối nào cũng kể chuyện, hết ý tưởng, con chán
- **Kỳ vọng MVP:** Nhập tên con, chọn chủ đề → có truyện hay trong 30s
- **Behavior:** Sử dụng sau 8h tối, trên mobile

### Persona 2: Anh Tuấn (35 tuổi)
- **Nghề nghiệp:** Kỹ sư phần mềm
- **Con:** Bé Linh, 5 tuổi + Bé Nam, 3 tuổi
- **Pain point:** Có 2 con, mỗi đứa 1 gu truyện khác nhau
- **Kỳ vọng MVP:** Multi-tenant để tách profile từng bé
- **Behavior:** Test kỹ, feedback chi tiết

### Persona 3: Chị Hoa (28 tuổi)
- **Nghề nghiệp:** Giáo viên mầm non
- **Con:** Đang dạy lớp mẫu giáo
- **Pain point:** Cần truyện có bài học cụ thể (dạy chia sẻ, dọn đồ chơi...)
- **Kỳ vọng MVP:** Chọn "bài học" → truyện có nội dung giáo dục đúng
- **Behavior:** Dùng cả ở lớp và ở nhà

## 6. MVP Success Metrics (Acceptance Criteria)

| Metric | Target | Cách đo |
|---|---|---|
| FE-BE tách rõ | Không có business logic trong FE | Code review |
| Prompt system hoạt động | 3 prompt tầng rõ ràng | Document check |
| Story generation pipeline | Planner → Writer → Reviewer | Log monitoring |
| Memory lưu/đọc được | Profile + lịch sử truyện | Integration test |
| Tenant isolation | Không lẫn dữ liệu | DB query test |
| Rate limit | Hoạt động theo request | Load test |
| Validation | Chặn input/output lỗi | Unit test |
| E2E flow | Phụ huynh test được | User testing |

## 7. Market Positioning

### Khác biệt so với các giải pháp hiện tại

| Sản phẩm | Điểm yếu | Chúng tôi |
|---|---|---|
| ChatGPT tự prompt | Nguy hiểm với trẻ em, nội dung không kiểm soát | Pipeline 3-stage + safety rules |
| Sách truyện giấy | Không cá nhân hóa, giới hạn kho | AI-sinh không giới hạn, cá nhân hóa |
| Youtube kể chuyện | Passive, không tương tác, quảng cáo | Có điểm dừng tương tác, an toàn |
| App kể chuyện khác | Thường 1 chiều, không học behavior | Memory system → càng dùng càng hay |

## 8. Monetization Direction (Post-MVP)

- **Freemium:** 5 truyện/tháng free
- **Premium:** Unlimited stories + analytics
- **Family Pack:** Multi-child + priority

> **MVP không lo payment.** Tập trung vào value validation trước.

## 9. Roadmap Giai đoạn

```
MVP Core (hiện tại)
├── Kiến trúc FE/BE/Engine
├── Prompt system
├── Pipeline 3-stage
├── Memory basic
├── Multi-tenant local
└── Validation layers

Phase 2
├── Auth Google OAuth
├── Analytics cơ bản
├── Voice đọc truyện
└── Cải thiện prompt

Phase 3
├── Recommendation engine
├── Graph memory
├── Community features
└── Premium subscription
```

## 10. Risks & Mitigation

| Risk | Impact | Mitigation |
|---|---|---|
| LLM sinh nội dung không ổn định | High | Reviewer stage + output validation + retry |
| Chi phí LLM mỗi request | Medium | Giới hạn 3 call/request, cache prompt |
| Người dùng không quen AI | Medium | UX tối giản, loading rõ ràng |
| Multi-tenant local khó mở rộng | Low | Thiết kế abstract tenant provider ngay từ đầu |
