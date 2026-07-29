# Requirement MVP - Core System cho Bedtime Story Companion

## 1. Mục tiêu

Xây dựng **core system MVP** cho sản phẩm kể chuyện trước giờ ngủ, tập trung vào:

* tách source FE/BE rõ ràng,
* thiết kế rules, system prompt, user prompt,
* quản lý memory,
* thiết kế core engine và architecture,
* điều phối số lần gọi LLM,
* validation ở cả BE/FE,
* lưu dữ liệu theo kiểu multi-tenant cục bộ trên thiết bị,
* chưa ưu tiên login đầy đủ, có thể dùng 0auth Google nếu cần.

MVP này chỉ nhằm kiểm chứng:

* phụ huynh có dùng được không,
* truyện có tạo ra ổn không,
* flow có đủ mượt không,
* hệ thống có đủ an toàn để test thật không.

---

## 2. Phạm vi MVP

### In scope

* FE app
* BE API
* LLM orchestration
* prompt system
* memory storage
* local multi-tenant storage
* validation layer
* rate limit per request
* basic auth tùy chọn

### Out of scope

* payment
* community
* recommendation engine
* voice clone
* video
* animation
* graph memory phức tạp
* production-grade account system nhiều tầng
* analytics dashboard phức tạp

---

## 3. Kiến trúc tổng quan

### 3.1 FE

Frontend chịu trách nhiệm:

* nhập dữ liệu bé,
* hiển thị form tạo truyện,
* hiển thị truyện đã sinh,
* hiển thị feedback,
* giữ trạng thái UI,
* gọi API BE.

### 3.2 BE

Backend chịu trách nhiệm:

* validate input,
* tạo prompt,
* điều phối call LLM,
* xử lý retry,
* lưu memory,
* lưu story history,
* trả response chuẩn cho FE,
* áp rate limit theo request.

### 3.3 LLM Layer

LLM chỉ làm các việc:

* sinh dàn ý,
* sinh truyện,
* review truyện,
* trích xuất memory,
* trả về output theo schema.

LLM không được tự do bịa logic ngoài rule của hệ thống.

---

## 4. Tách source FE / BE

### 4.1 FE responsibilities

FE chỉ làm:

* form input
* state management
* submit request
* render story
* render loading/error/empty
* hiển thị feedback

FE không làm:

* business logic sinh truyện,
* memory logic,
* prompt assembly,
* validation nghiệp vụ,
* routing multi-tenant.

### 4.2 BE responsibilities

BE làm toàn bộ:

* business rules,
* prompt construction,
* validation,
* memory writes,
* tenant isolation,
* orchestration LLM calls,
* response shaping.

---

## 5. Core engine requirement

## 5.1 Pipeline chính

Một request tạo truyện đi theo flow:

```text
FE input
→ FE validate sơ bộ
→ BE validate thật
→ Build context
→ Build prompts
→ Call LLM planner
→ Call LLM writer
→ Call LLM reviewer
→ Extract memory
→ Save story
→ Return response
```

## 5.2 Các stage trong engine

### Stage 1 - Input Normalization

Chuẩn hóa input từ FE:

* tên bé
* tuổi
* chủ đề
* điều muốn dạy
* tâm trạng
* ngôn ngữ

### Stage 2 - Rule Check

Kiểm tra:

* tuổi hợp lệ,
* content an toàn,
* trường bắt buộc đủ,
* giới hạn độ dài input.

### Stage 3 - Prompt Assembly

Sinh:

* system prompt,
* developer prompt,
* user prompt,
* story constraints,
* memory context nếu có.

### Stage 4 - LLM Orchestration

Tách ít nhất 3 lượt:

1. planner
2. writer
3. reviewer

### Stage 5 - Post-processing

* kiểm tra output theo schema,
* lọc lỗi,
* sửa format,
* lưu memory cần thiết,
* lưu story vào DB.

---

## 6. Prompt system

## 6.1 System prompt

System prompt phải cố định và chứa:

* vai trò AI,
* giọng văn,
* độ tuổi mục tiêu,
* nguyên tắc an toàn,
* nguyên tắc tiếng Việt,
* giới hạn nội dung,
* định dạng output bắt buộc.

System prompt là phần cứng, không để FE chỉnh lung tung như ném dầu vào động cơ.

## 6.2 Developer prompt

Developer prompt chứa:

* chiến lược kể chuyện,
* style guide,
* cấu trúc truyện,
* độ dài mục tiêu,
* số điểm tương tác,
* rule cho memory,
* rule cho reviewer.

## 6.3 User prompt

User prompt chứa:

* dữ liệu bé,
* mục tiêu phụ huynh,
* chủ đề truyện,
* input từ request hiện tại.

User prompt phải ngắn, có cấu trúc, không trộn rules vào.

---

## 7. Rules / Story Bible

### 7.1 Nội dung

Truyện phải:

* thuần Việt,
* dịu nhẹ,
* giàu hình ảnh,
* phù hợp trẻ 3-6 tuổi,
* có mở đầu, phát triển, tương tác, kết thúc.

### 7.2 Cấm tuyệt đối

* tình dục,
* bạo lực mạnh,
* kinh dị,
* ngôn ngữ thô tục,
* định kiến,
* nội dung người lớn,
* quảng cáo trá hình,
* chính trị.

### 7.3 Cấu trúc truyện

Mỗi truyện nên có:

* mở đầu,
* bối cảnh,
* xung đột nhẹ,
* 2-3 điểm dừng tương tác,
* kết thúc ấm áp,
* bài học nhẹ.

---

## 8. Memory requirement

## 8.1 Mục tiêu memory

Memory dùng để:

* nhớ tên bé,
* nhớ sở thích,
* nhớ nhân vật thích,
* nhớ chủ đề đã kể,
* nhớ phản hồi của phụ huynh,
* cá nhân hóa truyện lần sau.

## 8.2 Memory model

Memory phải lưu tối thiểu:

* child profile,
* story history,
* preference history,
* reaction history,
* named entities,
* relationship hints.

## 8.3 Memory write policy

Không phải dữ liệu nào cũng lưu.
Chỉ lưu những thứ:

* bền,
* hữu ích cho lần sau,
* không nhạy cảm quá mức,
* phục vụ cá nhân hóa.

## 8.4 Memory read policy

Khi sinh truyện mới:

* chỉ đọc memory liên quan,
* không nhét toàn bộ lịch sử vào prompt,
* ưu tiên memory gần đây và có ích nhất.

---

## 9. LLM call orchestration

## 9.1 Số lần call tối thiểu

MVP chuẩn nên có tối thiểu 3 call:

1. **Planner**
2. **Writer**
3. **Reviewer**

## 9.2 Có thể thêm call phụ

Nếu cần, có thêm:
4. **Memory Extractor**
5. **Formatter / Validator**

## 9.3 Mục tiêu điều phối

* giảm hallucination,
* kiểm soát chất lượng,
* tách trách nhiệm từng bước,
* dễ debug,
* dễ đo quality từng stage.

## 9.4 Rate limit

Mỗi request phải có giới hạn:

* số lần call LLM tối đa cho 1 request,
* số retry tối đa,
* timeout mỗi call,
* tổng thời gian tối đa cho request.

Gợi ý MVP:

* tối đa 3 lần retry cho 1 request,
* timeout ngắn cho từng call,
* nếu fail thì trả lỗi rõ ràng và cho retry bằng tay.

---

## 10. Validation requirement

## 10.1 FE validation

FE chỉ validate sơ bộ:

* field bắt buộc có nhập,
* tuổi nằm trong range hợp lệ,
* không để form rỗng,
* tránh nhập quá dài.

## 10.2 BE validation

BE là nơi validate thật:

* đúng schema,
* đúng độ tuổi,
* đúng rule an toàn,
* đúng giới hạn nội dung,
* đúng tenant,
* đúng format request.

## 10.3 Output validation

Output từ LLM phải được kiểm:

* có đủ tiêu đề,
* có nội dung,
* có điểm tương tác,
* có kết thúc,
* không vi phạm policy,
* parse được theo schema.

Nếu fail:

* retry theo policy,
* nếu vẫn fail thì fallback response.

---

## 11. Multi-tenant requirement

## 11.1 Mục tiêu

Không làm login phức tạp trong MVP, nhưng vẫn phải tách dữ liệu theo tenant.

## 11.2 Phương án MVP

Dùng **browser/device local DB index** làm nền cho multi-tenant cục bộ:

* mỗi thiết bị hoặc mỗi profile có một namespace riêng,
* dữ liệu tách theo tenant key,
* không trộn story, memory, history giữa các user.

## 11.3 Tenant identity options

### Option A - No login

* tenant được xác định bằng local device profile / browser storage / generated tenant id.

### Option B - Google OAuth nhẹ

* dùng 0auth để nhận diện phụ huynh,
* sau đó map vào tenant id riêng.

## 11.4 Requirement bắt buộc

* không được để lẫn dữ liệu giữa tenant,
* tenant id phải gắn vào mọi request,
* mọi story/memory/history phải ghi theo tenant.

---

## 12. Data schema requirement

## 12.1 Core entities

### Tenant

* tenant_id
* name
* auth_type
* created_at

### ChildProfile

* child_id
* tenant_id
* child_name
* age
* interests
* preferred_characters
* bedtime_goal
* created_at

### StoryRequest

* request_id
* tenant_id
* child_id
* theme
* goal
* mood
* status
* created_at

### Story

* story_id
* tenant_id
* child_id
* title
* content
* structure_json
* safety_status
* created_at

### MemoryItem

* memory_id
* tenant_id
* child_id
* type
* value
* confidence
* source_story_id
* created_at

### Feedback

* feedback_id
* tenant_id
* child_id
* story_id
* listened_complete
* wants_more
* suitable
* rating
* note
* created_at

---

## 13. API requirement

## 13.1 Suggested APIs

* `POST /story/create`
* `POST /story/feedback`
* `GET /story/latest`
* `GET /child-profile`
* `POST /child-profile`
* `GET /memory`
* `POST /tenant/init`

## 13.2 API rules

* mọi API phải có tenant context,
* mọi API phải validate,
* mọi API phải trả error message rõ ràng,
* response phải ổn định schema.

---

## 14. Error handling

## 14.1 Loại lỗi cần xử lý

* thiếu input,
* invalid age,
* LLM timeout,
* LLM output sai format,
* safety violation,
* DB write fail,
* tenant mismatch,
* local storage fail.

## 14.2 Fallback behavior

Nếu sinh truyện thất bại:

* hiển thị lỗi ngắn,
* cho phép thử lại,
* không làm crash flow,
* không mất input đã nhập.

---

## 15. Performance target

MVP chưa cần siêu tối ưu, nhưng cần:

* request có cảm giác phản hồi nhanh,
* loading rõ,
* retry không vô hạn,
* không treo UI.

Gợi ý:

* tổng thời gian tạo truyện phải ở mức chấp nhận được cho demo,
* nếu quá lâu thì phải có progress state rõ ràng.

---

## 16. Logging / observability

Cần log tối thiểu:

* request start/end,
* tenant id,
* prompt stage,
* LLM call count,
* retry count,
* validation fail,
* output safety fail,
* save success/fail.

Log dùng cho:

* debug,
* cải thiện prompt,
* đo chất lượng story.

---

## 17. MVP acceptance criteria

MVP core system được xem là đạt nếu:

* FE và BE tách rõ,
* prompt system hoạt động,
* story có thể sinh theo quy trình nhiều bước,
* memory có thể lưu và đọc lại,
* tenant không bị trộn,
* rate limit theo request hoạt động,
* validation chặn được input/output lỗi,
* phụ huynh test được flow end-to-end.

---

## 18. Non-goals của MVP này

Không làm trong vòng đầu:

* vector DB phức tạp,
* graph memory đầy đủ,
* recommendation engine,
* orchestration đa agent,
* payment,
* scale multi-region,
* real-time collaboration,
* admin console lớn.

---

## 19. Kết luận

MVP này không phải là một app kể chuyện đơn giản.
Nó là một **core engine có kỷ luật**, nơi:

* FE chỉ lo nhập và hiển thị,
* BE điều phối toàn bộ logic,
* LLM bị buộc phải đi theo rule,
* memory được kiểm soát,
* tenant được tách rõ,
* output có thể kiểm chứng.

Nếu làm đúng phần này, về sau mới có đường để mở rộng. Nếu làm sai, nó sẽ thành một app AI kể chuyện “nghe hay lắm” rồi sập ở chỗ lưu dữ liệu và lộ key như mấy thằng CTO thích tự vibe với AI.
