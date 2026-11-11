# Morse by Mouse (Chuột Phải)

Chrome / Edge (Chromium Manifest V3) extension cho phép bạn **gõ chữ bằng mã Morse bằng nút chuột phải** trên mọi trang web.

## Nguyên lý hoạt động & Cài đặt Macro (`+`)

Mặc định sau khi cài đặt:
- **Dots (`·`)**: **Chuột phải — Nhấn nhanh** (`< 200ms`, tùy chỉnh được)
- **Dash (`—`)**: **Chuột phải — Nhấn giữ** (`≥ 200ms`, tùy chỉnh được)
- **Space (`␣`)**: **Chuột trái — Nhấn nhanh** (chèn 1 dấu cách; nếu đang có `.`/`-` chưa chốt sẽ chốt chữ trước rồi thêm dấu cách). Click vào link, nút bấm hoặc ô nhập chưa focus vẫn hoạt động bình thường.
- **Xóa (`⌫`)**: **Chuột giữa (con lăn)** (xóa từng tín hiệu `.`/`-` nếu đang nhập dở, hoặc xóa từng ký tự đã chốt; giữ để xóa liên tục).
- **Ngừng nhấn một khoảng ngắn** (`600ms`): tự động giải mã chuỗi `.`/`-` thành ký tự và chèn vào ô đang nhập (hoặc bảng nháp trên HUD nổi).

### Gán nút chuột tự động bằng menu `+`
Mở popup extension → mục **Phím chuột & Macro**, bạn có 4 nút mặc định (**Dots (`·`)**, **Dash (`—`)**, **Space (`␣`)**, **Xóa (`⌫`)**) cùng tùy chọn **Dấu Việt (`ESC`)** (mặc định chưa gán nút chuột để bạn bật thêm nếu muốn gõ dấu một tay hoàn toàn bằng chuột):
- Bấm dấu **`+`** bên cạnh nút bất kỳ → nhấn nhanh hoặc nhấn giữ nút chuột muốn gán (`Chuột trái`, `Chuột phải`, `Chuột giữa`, `Mouse 4/5/...`) để extension tự nhận diện cả **nút chuột** lẫn **kiểu nhấn (Nhấn nhanh / Nhấn giữ)** và lưu lại ngay.
- Bấm **`×`** để gỡ phím của nút đó, hoặc bấm **`Mặc định`** để khôi phục cấu hình ban đầu.
- Giữ **`Shift + Click`** bất kỳ lúc nào để dùng chuột bình thường (mở menu chuột phải, đặt con trỏ, bôi đen chữ...).

## Tính năng chính

- **Chạy trực tiếp trên các trang web** (`<input>`, `<textarea>`, `contenteditable`, Shadow DOM), thay thế dấu tiếng Việt chính xác ngay tại vị trí con trỏ.
- **Hỗ trợ đầy đủ Tiếng Việt (ESC chế độ dấu)**:
  - Nhấn chữ cái gốc bằng chuột (ví dụ `a`, `o`, `e`, `u`, `d`), sau đó nhấn **`ESC`** (hoặc bấm nút **`ESC Dấu`** ngay trên HUD / popup thử nghiệm, hoặc nút chuột đã gán **Dấu Việt**) để chuyển sang **Diacritic Mode** rồi nhập mã Morse của dấu tạo chữ (`Ă`, `Â`, `Ê`, `Ô`, `Ơ`, `Ư`, `Đ`) hoặc thanh điệu (`Sắc`, `Huyền`, `Hỏi`, `Ngã`, `Nặng`).
  - Với chữ có cả dấu tạo chữ và thanh điệu (ví dụ `ắ = A → ESC → Ă → ESC → Sắc`), nhấn **`ESC`** / **`ESC Dấu`** lần thứ hai để vào **Tone Mode** và nhập mã thanh điệu. Nhấn `ESC` khi đang chờ dấu để thoát về **Normal Mode**.
- Chặn menu chuột phải mặc định khi đang gõ Morse; giữ **Shift + Chuột phải** để mở menu chuột phải bình thường.
- **HUD nổi (Shadow DOM)** ở góc dưới phải (kéo thả & tự né ô nhập thông minh): hiển thị trạng thái **Normal / Diacritic / Tone Mode** kèm nút bấm nhanh **`ESC Dấu`**, chuỗi `.`/`—` theo thời gian thực, thanh đo ngưỡng giữ thành `-`, gợi ý nhánh chữ có dấu tiếp theo, và bảng tra cứu mã Morse (`A–Z`, `0–9`, `Dấu`, `Việt`) tự động chuyển sang tab **`Việt`** cùng làm mờ các dấu không hợp lệ khi đang nhập dấu.
- **Âm thanh bíp (CW Sidetone)** bằng Web Audio API: đổi cao độ nhẹ khi giữ đủ ngưỡng sang `-`.
- **Phím tắt `Alt + M`**: bật / tắt nhanh extension.
- **2 chế độ phạm vi**:
  - *Mọi trang web*: bật mọi lúc trên trang (nhập vào ô đang focus hoặc tự do).
  - *Chỉ ô nhập liệu*: chỉ chuyển nút chuột thành Morse khi đang focus hoặc click vào ô nhập chữ; vùng trống/link giữ chuột bình thường.

## Cài đặt vào Chrome / Edge

1. Mở trình duyệt và truy cập `chrome://extensions` (hoặc `edge://extensions`).
2. Bật **Developer mode** (Chế độ dành cho nhà phát triển) ở góc trên bên phải.
3. Nhấn **Load unpacked** (Tải tiện ích đã giải nén) và chọn thư mục `d:\project\morse-by-mouse`.
4. Nếu đang mở sẵn tab web từ trước, hãy tải lại tab (`F5`) để script kích hoạt trên tab đó.

## Chạy kiểm thử đơn vị (Unit Tests)

```bash
node --test tests/morse.test.js
```

