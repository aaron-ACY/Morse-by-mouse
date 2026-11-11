# Morse by Mouse (Chuột Phải)

Chrome / Edge (Chromium Manifest V3) extension cho phép **gõ chữ cái, số, ký hiệu và đầy đủ Tiếng Việt bằng mã Morse thông qua chuột** trên mọi trang web.

---

## Phím tắt & Thao tác nhanh

- **Bật / Tắt plugin**: Nhấn cùng lúc **Chuột trái + Chuột phải** ở bất kỳ đâu trên trang (hoặc bật công tắc trong popup extension).
  > Mặc định sau khi cài đặt và mỗi khi mở lại trình duyệt, plugin luôn ở trạng thái **Tắt (`OFF`)** để đảm bảo thao tác chuột bình thường.
- **Hiện / Tắt hẳn popup hỗ trợ nổi (HUD)**: Nhấn **`Alt + M`** (chỉ hoạt động khi plugin đang bật; tắt hoàn toàn, không làm mờ; nhấn lại để mở lại).
- **Dùng chuột bình thường tạm thời**: Giữ **`Shift + Click`** bất kỳ lúc nào (mở menu chuột phải, đặt con trỏ, bôi đen văn bản...).

### Thiết lập chuột mặc định

| Hành động | Thao tác mặc định | Ghi chú |
| --- | --- | --- |
| **Dot (`·`)** | **Chuột phải — Nhấn nhanh** (`< 200ms`) | Tùy chỉnh được ngưỡng giữ |
| **Dash (`—`)** | **Chuột phải — Nhấn giữ** (`≥ 200ms`) | Có thanh đo trực quan & đổi cao độ âm báo |
| **Space (`␣`)** | **Chuột trái — Nhấn nhanh** | Tự chốt chữ đang gõ dở rồi chèn 1 dấu cách; click vào link/nút hoặc ô chưa focus vẫn hoạt động bình thường |
| **Xóa (`⌫`)** | **Con lăn giữa — Nhấn / Giữ** | Xóa tín hiệu `.`/`—` đang nhập dở, hoặc xóa ký tự trước con trỏ (giữ để xóa liên tục) |
| **Dấu Việt (`ESC`)** | Phím **`ESC`** / nút **`ESC Dấu`** | Có thể gán thêm lên nút chuột riêng trong popup nếu muốn gõ một tay |

- **Ngừng nhấn một khoảng ngắn** (`600ms` mặc định): tự động giải mã chuỗi `.`/`—` thành ký tự và chèn tại vị trí con trỏ.

### Gán nút chuột tự động trong `Menu gán nút chuột`

Mở popup extension → mục **Menu gán nút chuột** (gồm 5 hành động: **Dots**, **Dash**, **Space**, **Xóa**, **Dấu Việt**):
1. Bấm nút **`+`** cạnh hành động muốn đổi.
2. Nhấn nhanh (`< 200ms`) hoặc nhấn giữ (`≥ 200ms`) bất kỳ nút chuột nào (`Chuột trái`, `Chuột phải`, `Con lăn giữa`, `Mouse 4`, `Mouse 5`...) — extension tự nhận diện cả nút và kiểu nhấn.
3. Bấm **`×`** để gỡ phím của hành động đó, hoặc bấm **`Mặc định`** để khôi phục cấu hình ban đầu.

---

## Nhập Tiếng Việt (Vietnamese Morse Input)

Extension hỗ trợ đầy đủ **26 chữ cái A–Z**, **7 chữ mở rộng (`Ă, Â, Ê, Ô, Ơ, Ư, Đ`)** và **5 thanh điệu (`Sắc, Huyền, Hỏi, Ngã, Nặng`)**, chuẩn hóa **Unicode NFC** cho cả chữ thường và chữ HOA.

### Bảng mã mở rộng Tiếng Việt

**1. Dấu tạo chữ (Character Modifiers)**

| Ký tự | Chữ gốc | Mã mở rộng |
| --- | --- | --- |
| **Ă** | A | `.-` |
| **Â** | A | `-...` |
| **Ê** | E | `-.-.` |
| **Ô** | O | `-..` |
| **Ơ** | O | `.` |
| **Ư** | U | `..-` |
| **Đ** | D | `-..-` |

**2. Thanh điệu (Tone Marks)**

| Dấu thanh | Mã mở rộng |
| --- | --- |
| **Sắc** | `..` |
| **Huyền** | `--` |
| **Hỏi** | `.-.` |
| **Ngã** | `-.-` |
| **Nặng** | `...-` |

### Quy trình bỏ dấu bằng phím `ESC`

1. Gõ chữ cái gốc bằng chuột (ví dụ `a`, `e`, `o`, `u`, `d`), hệ thống ở **Normal Mode**.
2. Nhấn **`ESC`** (hoặc bấm nút **`ESC Dấu`** trên HUD / popup, hoặc nút chuột đã gán **Dấu Việt**) để chuyển sang **Diacritic Mode** (*Đang chờ nhập dấu*).
3. Nhập mã Morse của dấu tạo chữ hoặc dấu thanh bằng chuột:
   - `a` → `ESC` → `..` ⇒ `á`
   - `a` → `ESC` → `.-` ⇒ `ă`
   - `d` → `ESC` → `-..-` ⇒ `đ`
4. Với chữ có **cả dấu tạo chữ và thanh điệu** (hoặc muốn **đổi dấu / thanh điệu** trên ký tự vừa gõ), nhấn **`ESC`** (hoặc **`ESC Dấu`**) thêm lần thứ 2 để vào **Tone Mode**:
   - `a` → `ESC` → `.-` (`ă`) → `ESC` → `..` ⇒ `ắ`
   - `o` → `ESC` → `-..` (`ô`) → `ESC` → `...-` ⇒ `ộ`
   - Đang có `á` hoặc `ă` → nhấn `ESC` lần nữa → nhập `--` (Huyền) hoặc `-...` (`â`) để thay đổi dấu trực tiếp ngay tại con trỏ.
5. Nhấn `ESC` khi đang ở trạng thái chờ dấu để hủy chế độ dấu mà không làm mất chữ gốc; dùng nút **Xóa** khi đang nhập dở mã dấu sẽ chỉ xóa tín hiệu dấu.

---

## Tính năng nổi bật

- **Hoạt động trên mọi ô nhập liệu**: Hỗ trợ `<input>`, `<textarea>`, `contenteditable`, Shadow DOM và ô thử gõ ngay trong popup; thay thế ký tự có dấu chính xác tại vị trí con trỏ.
- **HUD nổi thông minh (Shadow DOM)**:
  - Kéo thả tự do và tự động né khi nằm đè lên ô nhập đang focus.
  - Hiển thị trạng thái **Normal Mode / Diacritic Mode / Tone Mode**, nút **`ESC Dấu`**, chuỗi `.`/`—` theo thời gian thực, thanh đo ngưỡng giữ sang `—`, và gợi ý ký tự có dấu tiếp theo.
  - Bảng tra cứu 4 tab (**`A–Z`**, **`0–9`**, **`Dấu`**, **`Việt`**) tự động chuyển sang tab **`Việt`** và làm mờ các dấu không hợp lệ khi đang bỏ dấu.
- **Âm thanh bíp phản hồi (Web Audio API)**:
  - Tùy chỉnh bật/tắt và mức âm lượng (`10%–100%`, mặc định `80%`).
  - Âm **Dot (`660 Hz`)**, **Dash (`840 Hz`)** khi giữ quá ngưỡng, cùng âm **Space (`520 Hz`)** và **Delete (`540 → 340 Hz`)** được tăng biên độ và giữ đỉnh ngắn giúp nghe rõ trên loa laptop.
- **Tùy chỉnh phạm vi & tốc độ**:
  - **2 phạm vi**: *Mọi trang web* hoặc *Chỉ ô nhập liệu*.
  - **3 mức tốc độ nhanh**: *Chậm* (`260 / 850 / 1800 ms`), *Chuẩn* (`200 / 600 / 1400 ms`), *Nhanh* (`140 / 420 / 1000 ms`), kèm thanh trượt tinh chỉnh riêng từng thông số, *Tự động cách* và *Chữ HOA (ABC)*.

---

## Cài đặt vào Chrome / Edge

1. Tải mã nguồn về máy (hoặc `git clone https://github.com/aaron-ACY/Morse-by-mouse.git`).
2. Mở trình duyệt và truy cập `chrome://extensions` (hoặc `edge://extensions`).
3. Bật **Developer mode** (Chế độ dành cho nhà phát triển) ở góc trên bên phải.
4. Nhấn **Load unpacked** (Tải tiện ích đã giải nén) và chọn thư mục gốc `Morse-by-mouse`.
5. Tải lại (`F5`) các tab web đang mở sẵn để content script hoạt động trên tab đó.

---

## Cấu trúc mã nguồn chính

- `manifest.json` — Khai báo Manifest V3, shortcut `Alt+M` (`toggle-morse`) và danh sách content scripts.
- `src/morse-table.js` — Bảng mã Morse quốc tế `A–Z`, `0–9`, dấu câu và hàm gợi ý nhánh tiếp theo.
- `src/vietnamese-morse.js` — Bộ phân tích trạng thái & bảng mã mở rộng Tiếng Việt (chuẩn Unicode NFC).
- `src/morse-engine.js` — Bộ máy xử lý thời gian nhấn Dot/Dash, timeout chốt chữ/tự cách, Space, Delete và chế độ dấu `ESC`.
- `src/morse-bindings.js` — Quản lý gán nút chuột động, xử lý trùng nút tap/hold và repeat-delete.
- `src/audio.js` — Web Audio API CW sidetone và âm báo Dot/Dash/Space/Delete.
- `src/text-inserter.js` — Chèn và thay thế ký tự tại con trỏ cho `<input>`, `<textarea>`, `contenteditable`.
- `src/hud-layout.js` — Tính toán vị trí HUD tự né ô nhập liệu.
- `src/content.js` — Điều phối sự kiện chuột/bàn phím (`Trái+Phải`, `Alt+M`, `ESC`), HUD Shadow DOM và đồng bộ cài đặt.
- `src/background.js` — Khởi tạo cấu hình mặc định (`enabled: false`), badge `ON`/`OFF` và lệnh `Alt+M`.
- `popup/` — Giao diện popup cài đặt, menu gán nút `+`, ô thử gõ và bảng tra cứu Morse.
