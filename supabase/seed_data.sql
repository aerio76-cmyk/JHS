-- 初始參照資料：科目清單 + 鼓勵小語庫
-- 不含任何真實姓名/Email，可安全進版控。在 schema.sql 執行完之後，接著執行這份。

insert into subjects (code, display_name, sort_order) values
  ('chi', '國文', 1),
  ('eng', '英文', 2),
  ('math', '數學', 3),
  ('sci', '自然', 4),
  ('soc', '社會', 5)
on conflict (code) do nothing;

insert into motivational_quotes (category, content, companion_reaction_key) values
  ('progress', '這次的分數比你上一次更靠近自己想要的樣子了，很扎實的一步。', 'sparkle'),
  ('progress', '看得出來這陣子的努力沒有白費，繼續保持這個節奏就好。', 'sparkle'),
  ('progress', '進步不用很快，像這樣一點一點往前，才是走得久的方式。', 'sparkle'),
  ('progress', '這次的表現，是你這段時間認真累積出來的結果。', 'sparkle'),
  ('progress', '比起追分數，更值得開心的是你找到了讓自己變好的方法。', 'sparkle'),
  ('progress', '這一步跨得很穩，下一次不用想著要更好，維持這樣就很棒了。', 'sparkle'),
  ('progress', '努力的痕跡都留在這次的成績裡了，辛苦了。', 'sparkle'),
  ('progress', '這樣的成長曲線，比任何一次滿分都更值得記錄。', 'sparkle'),

  ('stable', '穩穩地維持在自己的水準，這種穩定本身就是一種實力。', 'nod'),
  ('stable', '沒有大起大落，代表基礎打得很扎實，很好。', 'nod'),
  ('stable', '這次表現跟平常一樣好，代表這個實力是真的屬於你的。', 'nod'),
  ('stable', '穩定發揮的背後，其實藏著很多平常累積的努力。', 'nod'),
  ('stable', '不用每次都追求突破，能夠穩穩地站在這裡，已經很不容易。', 'nod'),
  ('stable', '這樣持續的表現，說明你已經抓到讀書的節奏了。', 'nod'),
  ('stable', '平穩前進也是一種前進，繼續照自己的步調走就好。', 'nod'),
  ('stable', '這次的分數，再一次證明了你的實力很扎實。', 'nod'),

  ('fluctuation', '這次的分數只是這段時間的其中一個切片，不是全部的你。', 'gentle'),
  ('fluctuation', '每一段學習都會有起伏，這只是暫時慢下來，累積力氣的時候。', 'gentle'),
  ('fluctuation', '這次的結果，或許正在提醒你可以調整一下讀書的方式，沒關係，慢慢找。', 'gentle'),
  ('fluctuation', '分數會波動很正常，重要的是你還在持續往前走。', 'gentle'),
  ('fluctuation', '這不是終點，只是這一段路稍微顛簸了一點。', 'gentle'),
  ('fluctuation', '給自己一點時間，每個人都會有需要沉澱的時候。', 'gentle'),
  ('fluctuation', '這次先放鬆一下心情，下一次段考再重新出發就好。', 'gentle'),
  ('fluctuation', '波動之後的再出發，往往比一路順遂更珍貴。', 'gentle'),

  ('peak', '這是你目前為止最亮眼的一次，好好記住這個感覺。', 'cheer'),
  ('peak', '突破自己過去的紀錄，這份成就感只屬於你自己。', 'cheer'),
  ('peak', '這次的分數，刷新了你自己的最佳紀錄，太厲害了！', 'cheer'),
  ('peak', '從來沒有這麼靠近自己的目標過，這一次真的做到了。', 'cheer'),
  ('peak', '這是屬於你的個人紀錄，值得好好慶祝一下。', 'cheer'),
  ('peak', '這次的表現超越了過去的自己，這才是最值得驕傲的事。', 'cheer'),
  ('peak', '這個瞬間值得被記錄下來，因為這是全新的你。', 'cheer'),
  ('peak', '恭喜你，這是目前為止最棒的一次成長里程碑。', 'cheer');
