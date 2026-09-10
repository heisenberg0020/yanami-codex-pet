// Original companion dialogue; snack order matches the 3 × 2 illustration atlas.
const content = {
  snacks: [
    { id: 'pudding', name: '焦糖布丁', description: '轻轻一晃，焦糖就跟着晃。', artIndex: 0, lines: [
      '先从边上挖一小口……好吧，这一口不算小。',
      '焦糖有一点点苦，正好把甜味留得更久。',
      '布丁要用小勺吃。这样快乐可以多来几次。',
      '杯底也很重要，最后一层焦糖可不能忘。',
    ] },
    { id: 'melonpan', name: '菠萝包', description: '酥酥的格子外皮，里面软乎乎。', artIndex: 1, lines: [
      '这个格子烤得好漂亮。先吃哪一角呢？',
      '掉在纸袋里的酥皮也要认真收好。',
      '明明没有菠萝，名字却让人更饿了。',
      '外面咔嚓，里面软软的。嗯，是个好下午。',
    ] },
    { id: 'strawberry-milk', name: '草莓牛奶', description: '粉粉的小纸盒，插上吸管就能出发。', artIndex: 2, lines: [
      '吸管一次就插进去了，今天的运气不错。',
      '先晃一晃，草莓味才不会全躲在下面。',
      '这盒冰得刚好，手心都有点凉了。',
      '喝到最后要把盒角捏一下，这是经验。',
    ] },
    { id: 'onigiri', name: '海苔饭团', description: '米饭握成小三角，海苔包住一边。', artIndex: 3, lines: [
      '饭团算正餐还是点心？先吃了再讨论。',
      '海苔还是脆的，得趁现在咬一大口。',
      '这么整齐的小三角，是怎么捏出来的呀。',
      '米饭很踏实。吃完这个，再慢慢往前走。',
    ] },
    { id: 'taiyaki', name: '红豆鲷鱼烧', description: '小鱼模样的热饼，藏着绵密红豆馅。', artIndex: 4, lines: [
      '从头还是从尾巴？今天让尾巴先出场。',
      '红豆一直装到尾巴，这家店很认真呢。',
      '等一等，里面还很烫……闻起来真香。',
      '鱼鳍这块最脆，我特地留到最后了。',
    ] },
    { id: 'dango', name: '三色团子', description: '粉、白、绿，三颗软糯的小圆子。', artIndex: 5, lines: [
      '三种颜色排在一起，连点心都有队形。',
      '慢慢嚼。团子这种东西，急不得。',
      '粉色这颗看起来更甜……可能是错觉。',
      '最后一颗总有点舍不得，那就认真吃完。',
    ] },
  ],
  stories: [
    { id: 'warm-bag', title: '纸袋还是温的', text: '店员把刚出炉的点心装进纸袋。回来的路上，手心一直暖暖的。' },
    { id: 'cat-at-door', title: '门口的店长', text: '便利店门口卧着一只猫。它检查了纸袋一眼，又继续晒太阳。' },
    { id: 'last-one', title: '刚好还有一份', text: '货架上剩下最后一份喜欢的点心。没有着急跑，也刚好赶上了。' },
    { id: 'tiny-umbrella', title: '雨停之前', text: '在屋檐下等了一小会儿雨。纸袋藏在怀里，回到家时一点都没湿。' },
    { id: 'long-way', title: '多走一条街', text: '绕路经过面包店，橱窗里亮着暖黄的灯。今天的采购因此多了一点香气。' },
    { id: 'receipt-fold', title: '折得很整齐', text: '小票沿着印字折成三段，正好塞进纸袋侧边。是值得留住的一小段路。' },
    { id: 'shop-radio', title: '收音机里的歌', text: '结账时，店里的收音机正好唱到副歌。出门以后，还轻轻哼了两句。' },
    { id: 'new-sign', title: '手写的小招牌', text: '柜台旁多了一块手写招牌。字有点歪，画在旁边的小点心倒是很圆。' },
    { id: 'crosswalk', title: '绿灯亮起来', text: '站在斑马线前数纸袋上的格子。数到第七个时，绿灯刚好亮了。' },
    { id: 'corner-bench', title: '街角的长椅', text: '路过那张熟悉的长椅，树影已经挪到另一边。点心带回来了，休息也可以慢慢来。' },
    { id: 'bell-ring', title: '门铃叮了一声', text: '推门进去时，小铃铛清脆地响了一下。拿好找零，关门时又听见同样的一声。' },
    { id: 'home-light', title: '看见家里的灯', text: '拐过最后一个路口，就看见熟悉的灯光。今天买到的这一份，要在舒服的地方吃。' },
  ],
  keepsakes: [
    { id: 'paper-bag', name: '小纸袋贴纸', description: '装得下点心，也装得下一次顺利归来。', symbol: '▱' },
    { id: 'shop-bell', name: '门铃贴纸', description: '叮的一声，把今天的小见闻留住。', symbol: '♧' },
    { id: 'home-star', name: '归途星星贴纸', description: '每次回到这里，都有一盏小小的灯。', symbol: '✧' },
  ],
};

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

export const catalog = freeze(content);
