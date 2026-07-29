# TDD Document — Bedtime Story Companion (MVP)

> **Version:** 1.0  
> **Ngày:** 2026-07-27  
> **Phương pháp:** Behavior-Driven Test — viết test theo kịch bản người dùng

---

## 1. Nguyên tắc Testing (MVP)

### Testing Pyramid (MVP)

```
         ╱─ E2E (2 critical flows) ─╲
        ╱── Integration (~10 tests) ──╲
       ╱──── Unit (~40 tests) ──────────╲
      ╱────── Static Analysis (TS strict) ──╲
```

| Tầng | MVP Target | Tool |
|---|---|---|
| Static | Strict mode, lint | ESLint, TypeScript strict |
| Unit | 80%+ coverage | Jest (NestJS), pytest (Python) |
| Integration | Core flows | Supertest + test DB |
| E2E | Happy path + error path | Playwright |

---

## 2. Unit Tests — NestJS (BE)

### 2.1 Validation Layer

| # | Test case | Input | Expected |
|---|---|---|---|
| UT-VAL-01 | Tuổi hợp lệ (3-6) | `{ age: 4 }` | Pass |
| UT-VAL-02 | Tuổi dưới 3 | `{ age: 2 }` | 422, error code `AGE_OUT_OF_RANGE` |
| UT-VAL-03 | Tuổi trên 6 | `{ age: 7 }` | 422, error code `AGE_OUT_OF_RANGE` |
| UT-VAL-04 | Tuổi là số âm | `{ age: -1 }` | 422, error code `INVALID_AGE` |
| UT-VAL-05 | Tuổi là float | `{ age: 4.5 }` | 422, error code `INVALID_AGE` |
| UT-VAL-06 | Tên bé rỗng | `{ child_name: "" }` | 422, `NAME_REQUIRED` |
| UT-VAL-07 | Tên bé quá dài (>50) | `{ child_name: "A".repeat(51) }` | 422, `NAME_TOO_LONG` |
| UT-VAL-08 | Theme rỗng | `{ theme: "" }` | 422, `THEME_REQUIRED` |
| UT-VAL-09 | Thiếu tenant-id header | — | 400, `TENANT_REQUIRED` |
| UT-VAL-10 | Request body là null | `null` | 400, `INVALID_REQUEST_BODY` |

### 2.2 Tenant Middleware

| # | Test case | Expected |
|---|---|---|
| UT-TEN-01 | Request có tenant-id hợp lệ | Gắn tenant vào request context |
| UT-TEN-02 | Request không có tenant-id | Sinh tenant-id mới, trả về trong response header |
| UT-TEN-03 | Tenant-id sai format | 400, `INVALID_TENANT` |
| UT-TEN-04 | Tenant-id quá dài (>64 chars) | 400, `INVALID_TENANT` |

### 2.3 Rate Limiter

| # | Test case | Expected |
|---|---|---|
| UT-RAT-01 | Request đầu tiên trong window | 200 OK |
| UT-RAT-02 | Request vượt quá limit | 429, `RATE_LIMIT_EXCEEDED` |
| UT-RAT-03 | Reset sau khi hết window | OK trở lại |
| UT-RAT-04 | Rate limit riêng cho từng tenant | Tenant A hết limit, tenant B vẫn OK |

### 2.4 Story Service

| # | Test case | Expected |
|---|---|---|
| UT-STO-01 | Tạo story với input hợp lệ | Trả về story response với request_id |
| UT-STO-02 | Engine trả về lỗi timeout | 502, `ENGINE_TIMEOUT` |
| UT-STO-03 | Engine trả về invalid format | 422 + log error |
| UT-STO-04 | Lưu story vào DB thành công | DB có record mới |
| UT-STO-05 | Tạo story với tenant khác nhau | DB records tách biệt |

### 2.5 Feedback Service

| # | Test case | Expected |
|---|---|---|
| UT-FB-01 | Feedback hợp lệ | 200 + memory updated |
| UT-FB-02 | Story-id không tồn tại | 404, `STORY_NOT_FOUND` |
| UT-FB-03 | Rating ngoài range (1-5) | 422, `INVALID_RATING` |
| UT-FB-04 | Feedback không thuộc tenant | 403, `TENANT_MISMATCH` |

---

## 3. Unit Tests — Engine (Python)

### 3.1 Prompt Assembly

| # | Test case | Input | Expected |
|---|---|---|---|
| UT-PR-01 | System prompt chứa role | — | Có "bạn là người kể chuyện" |
| UT-PR-02 | System prompt có safety rules | — | Có danh sách cấm |
| UT-PR-03 | System prompt có định dạng output | — | Có schema JSON |
| UT-PR-04 | Developer prompt có style guide | — | Có "giọng văn dịu nhẹ" |
| UT-PR-05 | User prompt chứa child_name | `{ child_name: "An" }` | Prompt có "An" |
| UT-PR-06 | User prompt KHÔNG chứa rules | — | Chỉ có data, không có instruction |
| UT-PR-07 | Memory context được inject | Có memory | Prompt có context "con thích công chúa" |
| UT-PR-08 | Không có memory → bỏ qua context | No memory | Prompt không có memory section |

### 3.2 LLM Pipeline

| # | Test case | Expected |
|---|---|---|
| UT-LLM-01 | Planner trả về outline hợp lệ | Outline có title + structure |
| UT-LLM-02 | Planner trả về thiếu field | Retry trigger |
| UT-LLM-03 | Planner retry hết → fail | Fallback response |
| UT-LLM-04 | Writer nhận outline → sinh story | Story có đủ sections |
| UT-LLM-05 | Writer output quá ngắn (<100 từ) | Retry + warning |
| UT-LLM-06 | Reviewer detect safety violation | `safety_status: "REJECTED"` |
| UT-LLM-07 | Reviewer approve story | `safety_status: "APPROVED"` |
| UT-LLM-08 | Reviewer trả về non-JSON | Parse fail → retry |

### 3.3 Memory Extractor

| # | Test case | Expected |
|---|---|---|
| UT-MEM-01 | Trích xuất tên bé từ truyện | Memory type = "child_name" |
| UT-MEM-02 | Trích xuất sở thích | Memory type = "interest" |
| UT-MEM-03 | Trích xuất nhân vật yêu thích | Memory type = "character" |
| UT-MEM-04 | Không có memory mới | Empty result |
| UT-MEM-05 | Confidence score < 0.3 → discard | Không lưu memory |

### 3.4 Output Validator

| # | Test case | Expected |
|---|---|---|
| UT-OV-01 | Output đúng schema | Parse thành công |
| UT-OV-02 | Output thiếu title | Validation fail |
| UT-OV-03 | Output có nội dung cấm (bạo lực) | Safety violation |
| UT-OV-04 | Output có nội dung cấm (tình dục) | Safety violation |
| UT-OV-05 | Output chứa HTML/script | Sanitized |

---

## 4. Integration Tests

### 4.1 FE → BE Integration

| # | Test case | Steps | Expected |
|---|---|---|---|
| IT-FE-01 | Submit form đúng → story response | Post form → receive story JSON | 200, có title + content |
| IT-FE-02 | Submit form thiếu field | Post form thiếu theme | 422, error rõ field |
| IT-FE-03 | Submit với age sai | Post form age=10 | 422 |
| IT-FE-04 | Retry story khi fail network | Submit → network error → retry | Retry thành công |

### 4.2 BE → Engine Integration

| # | Test case | Expected |
|---|---|---|
| IT-ENG-01 | BE gửi request hợp lệ → Engine trả story | Response có đúng schema |
| IT-ENG-02 | Engine timeout → BE handle | 502 + retry |
| IT-ENG-03 | Engine trả error → BE log + trả user | Error message rõ ràng |
| IT-ENG-04 | Tenant context được forward đến Engine | Engine log có tenant_id |

### 4.3 DB Integration

| # | Test case | Expected |
|---|---|---|
| IT-DB-01 | Lưu story → đọc lại được | Nội dung khớp |
| IT-DB-02 | Lưu memory → query theo tenant | Chỉ trả memory của tenant đó |
| IT-DB-03 | Lưu feedback → story feedback count tăng | Feedback gắn đúng story |

---

## 5. E2E Tests

### 5.1 Happy Path

```
Flow:
1. User mở app → thấy form tạo truyện
2. Nhập tên bé (An), tuổi (4), chủ đề (công chúa), bài học (dũng cảm)
3. Submit
4. Thấy loading state (spinner / progress)
5. Nhận story với:
   - Title: "Công chúa An dũng cảm"
   - Content: sections
   - Interaction points: 2
6. Đọc truyện → click "tiếp theo" ở điểm tương tác
7. Submit feedback (rating 5, thích)
8. Lần sau mở app → thấy tên bé An đã được nhớ
```

### 5.2 Error Path

```
Flow:
1. User mở app
2. Submit form RỖNG
3. FE hiển thị lỗi validation ngay (không gọi API)
4. User nhập age = 0
5. FE hiển thị lỗi age
6. User sửa age = 4, submit
7. BE trả lỗi timeout → FE hiển thị "server busy, thử lại sau"
8. User click "thử lại"
9. Thành công
```

### 5.3 Multi-tenant Path

```
Flow:
1. User A (tenant-1) tạo truyện cho "An"
2. User B (tenant-2, cửa sổ ẩn danh) tạo truyện cho "Bình"
3. User A xem lịch sử → chỉ thấy truyện của An
4. User B xem lịch sử → chỉ thấy truyện của Bình
5. Feedback của user A không ảnh hưởng user B
```

---

## 6. Acceptance Criteria Checklist

### Input Validation
- [ ] Tuổi: int, 3–6
- [ ] Tên: string, 1–50 chars
- [ ] Theme: string, 1–200 chars
- [ ] Goal (optional): string, max 500 chars
- [ ] Mood (optional): enum

### Output Validation
- [ ] Có title (non-empty)
- [ ] Có content (non-empty, ≥ 100 từ)
- [ ] Có it nhat 1 interaction point
- [ ] An toàn (no violence, sex, horror)
- [ ] Parse được JSON với schema

### Tenant Isolation
- [ ] Mọi entity có tenant_id
- [ ] Mọi query filter theo tenant_id
- [ ] Không thể query cross-tenant

### Error Handling
- [ ] Lỗi FE: message ngắn, retry UI
- [ ] Lỗi BE: error code + message + request_id
- [ ] Lỗi Engine: fallback + log
- [ ] Timeout: user thấy "thử lại sau"
- [ ] LLM fail: retry → fallback response

### Security
- [ ] Rate limit: 10 req/min/tenant
- [ ] Input sanitized (no XSS, SQLi)
- [ ] Output safety filter
- [ ] No stack trace in response
