import { BedtimeStory } from '../types';

export const TOPIC_SUGGESTIONS = [
  { id: 'khung-long', name: 'Khủng long', icon: '🦖' },
  { id: 'cong-chua', name: 'Công chúa', icon: '👑' },
  { id: 'xe-cuu-hoa', name: 'Xe cứu hỏa', icon: '🚒' },
  { id: 'dong-vat', name: 'Động vật', icon: '🦊' },
  { id: 'gia-dinh', name: 'Gia đình', icon: '🏡' },
  { id: 'thien-nhien', name: 'Thiên nhiên', icon: '🌿' },
  { id: 'bien', name: 'Biển cả', icon: '🌊' },
  { id: 'vu-tru', name: 'Vũ trụ', icon: '🚀' },
];

export const LESSON_SUGGESTIONS = [
  { id: 'chia-se', name: 'Chia sẻ', icon: '🌱' },
  { id: 'trung-thuc', name: 'Trung thực', icon: '🤝' },
  { id: 'dung-cam', name: 'Dũng cảm', icon: '🦁' },
  { id: 'le-phep', name: 'Lễ phép', icon: '🌸' },
  { id: 'lang-nghe', name: 'Biết lắng nghe', icon: '🎧' },
  { id: 'yeu-thien-nhien', name: 'Yêu thiên nhiên', icon: '🍃' },
  { id: 'giup-do', name: 'Giúp đỡ bạn bè', icon: '💛' },
];

export const MOOD_SUGGESTIONS = [
  { id: 'vui-ve', name: 'Vui vẻ', icon: '😊' },
  { id: 'hieu-dong', name: 'Hiếu động', icon: '⚡' },
  { id: 'met-moi', name: 'Mệt mỏi', icon: '🥱' },
  { id: 'nung-niu', name: 'Nũng nịu', icon: '🥺' },
  { id: 'tram-lang', name: 'Trầm lắng', icon: '💭' },
];

export const SAMPLE_STORIES: BedtimeStory[] = [
  {
    id: 'sample-1',
    title: 'Đêm nay, bé An và chú Rùa nhỏ dũng cảm',
    childName: 'An',
    childAge: 4,
    topic: 'Động vật',
    lesson: 'Chia sẻ & Dũng cảm',
    createdAt: new Date().toISOString(),
    segments: {
      opening: 'Tại khu rừng Xanh Thẳm, khi những ngôi sao nhỏ bắt đầu nhấp nháy trên bầu trời đêm dịu mát, bé An khoác chiếc áo choàng màu xanh lá và cùng chú Rùa Tốt Bụng đi dạo bên bờ suối trong lành.',
      situation: 'Màn đêm buông xuống nhẹ nhàng. Tiếng dế kêu rỉ rả nghe như một bản nhạc ru ngủ êm ái. Chú Rùa nhỏ ôm trong tay một quả táo đỏ chín mọng mà chú vừa nhặt được dưới gốc cây đại thụ.',
      interaction1: 'Hãy hỏi bé: "Nếu bé An có một quả táo thơm ngon như thế, bé An có muốn chia sẻ cùng bạn Rùa nhỏ không con?"',
      challenge: 'Đột nhiên, từ lùm cây vang lên tiếng "chíp chíp" khe khẽ. Cả hai bạn dừng lại và nhìn thấy một chú Sóc con đang thu mình vì hơi lạnh đêm đông. Sóc con thì thầm: "Tớ đói quá và chưa tìm thấy đường về tổ..."',
      interaction2: 'Hãy hỏi bé: "Con đoán xem bé An và chú Rùa nhỏ sẽ làm gì để giúp bạn Sóc con bây giờ?"',
      ending: 'Bé An nhẹ nhàng nắm lấy tay Sóc con, còn bạn Rùa nhanh nhẹn bẻ đôi quả táo ngọt lịm tặng Sóc con. Cả ba bạn cùng ôm nhau thật ấm áp dưới ánh trăng dịu dàng. Bầu trời đêm như mỉm cười gửi tặng những làn gió nhẹ ru cõi lòng.',
      interaction3: 'Hãy hỏi bé: "Con có cảm thấy ấm áp trong lòng khi chúng mình biết yêu thương và giúp đỡ bạn bè không?"',
      moralSummary: '💡 Bài học ấm áp: Khi chúng ta biết sẻ chia và giúp đỡ người khác bằng trái tim chân thành, niềm vui sẽ lan tỏa và mang lại cho ta những giấc mơ thật ngọt ngào.'
    }
  },
  {
    id: 'sample-2',
    title: 'Một chuyến phiêu lưu cùng Khủng long Rex',
    childName: 'Minh',
    childAge: 5,
    topic: 'Khủng long',
    lesson: 'Giúp đỡ bạn bè',
    createdAt: new Date().toISOString(),
    segments: {
      opening: 'Ở thung lũng Mây Hồng, bé Minh có một người bạn rất đặc biệt tên là Khủng long Rex. Dù Rex rất to lớn nhưng chú lại vô cùng hiền lành và luôn có đôi mắt hiền từ như chiếc bánh quy bơ.',
      situation: 'Tối nay, thung lũng chìm vào không gian yên bình. Bé Minh cùng Rex ngồi trên ngọn đồi nhỏ ngắm nhìn những vệt sao sa lấp lánh như những dải ruy-băng bạc.',
      interaction1: 'Hãy hỏi bé: "Con có muốn cùng bé Minh trèo lên lưng bạn Khủng long Rex hiền lành để ngắm sao không?"',
      challenge: 'Lúc ấy, chú Chim Sâu nhỏ vô tình làm rơi chiếc tổ hoa lá xuống thảm cỏ mềm. Chim Sâu con luống cuống không biết làm sao để đưa tổ lên cành cao khi trời đã tối.',
      interaction2: 'Hãy hỏi bé: "Bạn Rex rất cao, còn bé Minh thì rất khéo léo. Con đoán hai bạn sẽ phối hợp thế nào để đưa tổ chim về cành cũ?"',
      ending: 'Rex nhẹ nhàng nghiêng mình làm bậc thang, bé Minh vươn tay đặt chiếc tổ chim an toàn lên cành thùy dương. Bạn Chim Sâu vui mừng hót lên tiếng ru êm dịu gửi lời cảm ơn. Đêm dần sâu, Rex vỗ nhẹ chiếc đuôi xinh ru bé Minh vào giấc ngủ yên bình.',
      interaction3: 'Hãy hỏi bé: "Bây giờ mi mắt con đã thấy nheo nheo mệt chưa? Chúng mình cùng nhắm mắt lại chợp mắt như bé Minh nhé!"',
      moralSummary: '💡 Bài học ấm áp: Sự khéo léo kết hợp cùng tinh thần sẵn sàng giúp đỡ luôn đem lại sự bình yên và hạnh phúc cho mọi người xung quanh.'
    }
  }
];
