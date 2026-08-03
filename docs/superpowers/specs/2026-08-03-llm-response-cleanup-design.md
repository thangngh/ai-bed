# Design: Layer làm sạch LLM response (Pipeline tầng chung)

**Ngày:** 2026-08-03
**Bối cảnh:** Bug khi Engine gọi LLM qua custom proxy `http://localhost:20128` (OpenAI-compatible, model `open-code`).
**Dự án:** AI-Bedtime (Engine Python FastAPI)

## 1. Vấn đề (đã tái hiện)

Thử nghiệm thực tế qua proxy cho ra kết quả:
- Gọi `POST /v1/chat/completions` trả `200` nhưng body có dạng:
  ```
  {...json...}data: [DONE]\n\n
  ```
  tức body là JSON hợp lệ **kèm trailing SSE marker `data: [DONE]`**.

Lỗi tái hiện được:
1. **`Engine/core/llm/custom_client.py`**: gọi `response.json()` → `JSONDecodeError: Extra data: line 1 column ...` vì body có đuôi thừa.
2. **`Engine/core/pipeline.py`**: kể cả khi qua được client, `json.loads(raw)` cũng fail khi content trả về lẫn văn bản thừa / nhiều JSON block (`Extra data`).

Giải pháp phải áp dụng chung cho **mọi provider** (OpenAI/Gemini/Custom), không chỉ riêng custom.

## 2. Thiết kế

### 2.1 Sửa `Engine/core/llm/custom_client.py`

`CustomClient.complete()`:
- Đọc `response.text()` thay vì `response.json()`.
- Cắt bỏ trailing `data: [DONE]` và khoảng trắng.
- `json.loads` body → đọc `choices[0].message.content` trả về **text thô**, giữ nguyên hợp đồng `BaseLLMClient.complete`.
- Về bản chất proxy vẫn là "custom LLM"; không đổi hành vi OpenAI/Gemini clients.

### 2.2 Tạo `Engine/core/cleanup.py` + dùng trong `Engine/core/pipeline.py`

- Hàm `extract_json_block(text: str) -> Any`:
  - Dùng `json.JSONDecoder().raw_decode` lặp qua chuỗi, bỏ phần dư ở đầu (whitespace, văn bản, marker `data:...`).
  - Trả block JSON hợp lệ **đầu tiên** (dict hoặc list).
  - An toàn với chuỗi sạch, trailing `[DONE]`, văn bản lẫn, nhiều JSON block.
- Thay toàn bộ `json.loads(raw)` trong `_call_retry` và `_review_story` (pipeline.py) bằng `extract_json_block(raw)`.
- Áp dụng cho mọi provider vì pipeline là nơi gọi chung.

## 3. Kiến trúc / data flow

```
LLM response text (mọi provider)
  -> custom_client.complete(): strip trailing data:[DONE] -> raw content text
  -> pipeline._call_retry(): extract_json_block(raw) -> dict -> validate
  -> pipeline._review_story(): extract_json_block(raw) -> dict
```

Không thay đổi hợp đồng `BaseLLMClient.complete` (vẫn trả `str`).

## 4. Xử lý lỗi

- `extract_json_block` không tìm thấy JSON hợp lệ → raise `ValueError`.
- Pipeline giữ nguyên try/except hiện tại: nếu fail → retry → fallback story.

## 5. Kiểm thử

- `Engine/tests/test_cleanup.py` (mới):
  - chuỗi sạch JSON → trả dict đúng.
  - JSON kèm trailing `data: [DONE]` → trả dict đúng.
  - chuỗi lẫn văn bản phía trước/sau → trả block đầu tiên.
  - nhiều JSON block → trả block đầu tiên.
  - không có JSON hợp lệ → raise `ValueError`.
- `Engine/tests/test_custom_client.py` (bổ sung):
  - mock body có `data: [DONE]` → `complete()` trả `choices[0].message.content`.
- Chạy `cd Engine && python -m pytest tests/ -v`.

## 6. Ngoại lệ phạm vi (không làm)

- Không thêm retry/stripping vào OpenAI/Gemini clients.
- Không đổi schema validation của `validator.py`.
- Không đổi hợp đồng engine gọi BE.