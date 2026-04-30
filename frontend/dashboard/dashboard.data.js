const PLAYERS_KEY = "players";
const SYNC_KEY = "syncState";
const DEBUG_KEY = "parseDebug";
const BACKUP_STATE_KEY = "localBackupState";
const CLOUD_AUTH_KEY = "cloudAuth";

const MODE_LABELS = {
  1: "全部",
  2: "排位赛",
  3: "休闲赛",
  4: "比赛间对战",
  5: "格斗中心对战"
};

const MODE_MATCH_KEYWORDS = {
  1: [],
  2: ["排位"],
  3: ["休闲"],
  4: ["比赛间", "自定义", "自建", "custom"],
  5: ["格斗中心", "battle hub", "battlehub"]
};

const PROFILE_TAB_META = {
  winrate: { title: "胜率", modeDisabled: false },
  league: { title: "段位积分", modeDisabled: true },
  master: { title: "Master积分", modeDisabled: true },
  battles: { title: "对战", modeDisabled: false },
  achievements: { title: "格斗成就", modeDisabled: false }
};

PROFILE_TAB_META.winrate.seasonDisabled = false;
PROFILE_TAB_META.league.seasonDisabled = false;
PROFILE_TAB_META.master.seasonDisabled = false;
PROFILE_TAB_META.battles.seasonDisabled = false;
PROFILE_TAB_META.achievements.modeDisabled = true;
PROFILE_TAB_META.achievements.seasonDisabled = true;

const FRAMEDATA_SOURCE = {};
const FRAMEDATA_CHAR_LABELS = {};
const FRAMEDATA_LOCAL_ROWS = {};
const FRAMEDATA_DATA_URL = "./framedata.local.json";
const FRAMEDATA_ICON_BASE_URL = "./assets/framedata-icons";
const FRAMEDATA_DISPLAY_LABELS = {
  aki: "阿鬼",
  alex: "阿里克斯",
  blanka: "布兰卡",
  cammy: "嘉米",
  chunli: "春丽",
  cviper: "深红毒蛇",
  deejay: "迪杰",
  dhalsim: "达尔西姆",
  ed: "爱德",
  ehonda: "本田",
  elena: "艾琳娜",
  gouki_akuma: "豪鬼",
  guile: "古烈",
  jamie: "杰米",
  jp: "JP",
  juri: "蛛俐",
  ken: "肯",
  kimberly: "金佰莉",
  lily: "莉莉",
  luke: "卢克",
  mai: "舞",
  manon: "曼侬",
  marisa: "玛丽莎",
  rashid: "拉希德",
  ryu: "隆",
  sagat: "沙加特",
  terry: "特瑞",
  vega_mbison: "维加",
  zangief: "桑吉尔夫"
};
const FRAMEDATA_OVERRIDE_URLS = {
  aki: "./framedata.official.aki.json",
  alex: "./framedata.official.alex.json",
  blanka: "./framedata.official.blanka.json",
  cammy: "./framedata.official.cammy.json",
  chunli: "./framedata.official.chunli.json",
  cviper: "./framedata.official.cviper.json",
  deejay: "./framedata.official.deejay.json",
  dhalsim: "./framedata.official.dhalsim.json",
  ed: "./framedata.official.ed.json",
  ehonda: "./framedata.official.ehonda.json",
  elena: "./framedata.official.elena.json",
  gouki_akuma: "./framedata.official.gouki_akuma.json",
  guile: "./framedata.official.guile.json",
  jamie: "./framedata.official.jamie.json",
  jp: "./framedata.official.jp.json",
  juri: "./framedata.official.juri.json",
  ken: "./framedata.official.ken.json",
  kimberly: "./framedata.official.kimberly.json",
  lily: "./framedata.official.lily.json",
  luke: "./framedata.official.luke.json",
  mai: "./framedata.official.mai.json",
  manon: "./framedata.official.manon.json",
  marisa: "./framedata.official.marisa.json",
  rashid: "./framedata.official.rashid.json",
  ryu: "./framedata.official.ryu.json",
  sagat: "./framedata.official.sagat.json",
  terry: "./framedata.official.terry.json",
  vega_mbison: "./framedata.official.vega_mbison.json",
  zangief: "./framedata.official.zangief.json"
};

const ACHIEVEMENT_FIELD_GROUPS = [
  {
    group: "战斗风格（Drive）",
    items: [
      { label: "驱动格挡占比", key: "gauge_rate_drive_guard", format: "ratioPercent" },
      { label: "驱动冲击占比", key: "gauge_rate_drive_impact", format: "ratioPercent" },
      { label: "OD必杀占比", key: "gauge_rate_drive_arts", format: "ratioPercent" },
      { label: "Parry Rush占比", key: "gauge_rate_drive_rush_from_parry", format: "ratioPercent" },
      { label: "Cancel Rush占比", key: "gauge_rate_drive_rush_from_cancel", format: "ratioPercent" },
      { label: "驱动反击占比", key: "gauge_rate_drive_reversal", format: "ratioPercent" },
      { label: "其他驱动消耗占比", key: "gauge_rate_drive_other", format: "ratioPercent" }
    ]
  },
  {
    group: "战斗风格（SA）",
    items: [
      { label: "SA1占比", key: "gauge_rate_sa_lv1", format: "ratioPercent" },
      { label: "SA2占比", key: "gauge_rate_sa_lv2", format: "ratioPercent" },
      { label: "SA3占比", key: "gauge_rate_sa_lv3", format: "ratioPercent" },
      { label: "CA占比", key: "gauge_rate_ca", format: "ratioPercent" }
    ]
  },
  {
    group: "攻防关键指标",
    items: [
      { label: "造成眩晕次数", key: "stun", format: "count" },
      { label: "被眩晕次数", key: "received_stun", format: "count" },
      { label: "投技次数", key: "throw_count", format: "count" },
      { label: "被投技次数", key: "received_throw_count", format: "count" },
      { label: "拆投次数", key: "throw_tech", format: "count" },
      { label: "角落压制时长", key: "corner_time", format: "seconds" },
      { label: "被角落压制时长", key: "cornered_time", format: "seconds" }
    ]
  },
  {
    group: "模式游玩场次",
    items: [
      { label: "排位赛场次", key: "rank_match_play_count", format: "count" },
      { label: "休闲赛场次", key: "casual_match_play_count", format: "count" },
      { label: "比赛间场次", key: ["custom_room_match_play_count", "custom_match_play_count"], format: "count" },
      { label: "格斗中心场次", key: "battle_hub_match_play_count", format: "count" }
    ]
  },
  {
    group: "其他成就",
    items: [
      { label: "总游玩点数", key: "total_all_character_play_point", format: "count" },
      { label: "挑战达成次数", key: "target_clear_count", format: "count" },
      { label: "Rival AI 最高段位", key: "rival_ai_highest_league_rank_txt", format: "text" },
      { label: "Rival AI 挑战达成", key: "rival_ai_achieved_challenge_count", format: "count" },
      { label: "Enjoy 总点数", key: "enjoy_total_point", format: "count" },
      { label: "Enjoy 玩家点数", key: "enjoy_user_point", format: "count" },
      { label: "Enjoy 对战点数", key: "enjoy_fight_point", format: "count" }
    ]
  }
];

const state = {
  players: {},
  syncState: {},
  parseDebug: {},
  backupState: {},
  cloudAuth: { loggedIn: false, user: null, apiBase: "", fullSyncRequired: false },
  selectedSid: null,
  currentView: "overview",
  currentCharacter: "",
  metric: "mr",
  rangeDays: "0",
  detailRangeDays: 0,
  page: 1,
  pageSize: 20,
  chartPoints: [],
  profileTab: "winrate",
  profileSeason: "",
  profileMode: "1",
  profileCharacterTool: "",
  framedataCharacter: "luke",
  framedataMode: "classic",
  framedataCache: {},
  framedataDatasetLoading: false,
  framedataDatasetLoaded: false,
  framedataDatasetError: "",
  framedataDatasetUpdatedAt: "",
  profileBattleSortBy: "battle",
  profileBattleSortOrder: "desc"
};

const refs = {
  root: document.body,
  fullSyncBtn: document.getElementById("fullSyncBtn"),
  silentSyncBtn: document.getElementById("silentSyncBtn"),
  cloudSyncBtn: document.getElementById("cloudSyncBtn"),
  importBackupBtn: document.getElementById("importBackupBtn"),
  importBackupInput: document.getElementById("importBackupInput"),
  refreshBtn: document.getElementById("refreshBtn"),
  syncStatus: document.getElementById("syncStatus"),
  cloudAuthStatus: document.getElementById("cloudAuthStatus"),
  cloudAuthUser: document.getElementById("cloudAuthUser"),
  cloudAccountToggle: document.getElementById("cloudAccountToggle"),
  cloudPanelBody: document.getElementById("cloudPanelBody"),
  cloudNavTitle: document.getElementById("cloudNavTitle"),
  cloudNavSummary: document.getElementById("cloudNavSummary"),
  cloudLoginForm: document.getElementById("cloudLoginForm"),
  cloudEmailInput: document.getElementById("cloudEmailInput"),
  cloudPasswordInput: document.getElementById("cloudPasswordInput"),
  cloudLoginBtn: document.getElementById("cloudLoginBtn"),
  cloudRegisterBtn: document.getElementById("cloudRegisterBtn"),
  cloudLogoutBtn: document.getElementById("cloudLogoutBtn"),
  debugBox: document.getElementById("debugBox"),
  sideTabs: Array.from(document.querySelectorAll(".section-nav-button")),
  viewProfile: document.getElementById("view-profile"),
  viewBattlelog: document.getElementById("view-battlelog"),
  viewFramedata: document.getElementById("view-framedata"),
  battleCharacterList: document.getElementById("battleCharacterList"),
  overviewCurrentScore: document.getElementById("overviewCurrentScore"),
  overviewCurrentScoreNote: document.getElementById("overviewCurrentScoreNote"),
  overviewWinRate: document.getElementById("overviewWinRate"),
  overviewWinRateNote: document.getElementById("overviewWinRateNote"),
  overviewMainCharacter: document.getElementById("overviewMainCharacter"),
  overviewMainCharacterNote: document.getElementById("overviewMainCharacterNote"),
  overviewRiskCharacter: document.getElementById("overviewRiskCharacter"),
  overviewRiskCharacterNote: document.getElementById("overviewRiskCharacterNote"),
  overviewProfileLinks: Array.from(document.querySelectorAll(".overview-profile-link")),
  characterTrendTitle: document.getElementById("characterTrendTitle"),
  characterTrendSvg: document.getElementById("characterTrendSvg"),
  characterTrendWrap: document.getElementById("characterTrendWrap"),
  characterTrendEmpty: document.getElementById("characterTrendEmpty"),
  characterTrendTooltip: document.getElementById("characterTrendTooltip"),
  characterTrendAxis: document.getElementById("characterTrendAxis"),
  overviewFramedataDirectory: document.getElementById("overviewFramedataDirectory"),
  profileSideBtns: Array.from(document.querySelectorAll(".profile-side-btn")),
  chartTitle: document.getElementById("chartTitle"),
  chartStats: document.getElementById("chartStats"),
  scoreChart: document.getElementById("scoreChart"),
  chartWrap: document.getElementById("chartWrap"),
  chartAxis: document.getElementById("chartAxis"),
  chartEmpty: document.getElementById("chartEmpty"),
  chartTooltip: document.getElementById("chartTooltip"),
  metricSelect: document.getElementById("metricSelect"),
  rangeSelect: document.getElementById("rangeSelect"),
  detailTitle: document.getElementById("detailTitle"),
  detailStats: document.getElementById("detailStats"),
  detailRangeSelect: document.getElementById("detailRangeSelect"),
  matchesBody: document.getElementById("matchesBody"),
  pageSizeSelect: document.getElementById("pageSizeSelect"),
  prevPageBtn: document.getElementById("prevPageBtn"),
  nextPageBtn: document.getElementById("nextPageBtn"),
  pageInfo: document.getElementById("pageInfo"),
  profileSectionTitle: document.getElementById("profileSectionTitle"),
  profileSeasonSelect: document.getElementById("profileSeasonSelect"),
  profileModeSelect: document.getElementById("profileModeSelect"),
  profileCharacterWrap: document.getElementById("profileCharacterWrap"),
  profileCharacterSelect: document.getElementById("profileCharacterSelect"),
  profileBattleSortWrap: document.getElementById("profileBattleSortWrap"),
  profileBattleSortSelect: document.getElementById("profileBattleSortSelect"),
  profileBattleOrderWrap: document.getElementById("profileBattleOrderWrap"),
  profileBattleOrderSelect: document.getElementById("profileBattleOrderSelect"),
  profileStats: document.getElementById("profileStats"),
  profileHint: document.getElementById("profileHint"),
  profileAchievementsBoard: document.getElementById("profileAchievementsBoard"),
  profileTable: document.getElementById("profileTable"),
  profileHeadRow: document.getElementById("profileHeadRow"),
  profileBody: document.getElementById("profileBody"),
  framedataTitle: document.getElementById("framedataTitle"),
  framedataModeWrap: document.getElementById("framedataModeWrap"),
  framedataModeClassicBtn: document.getElementById("framedataModeClassicBtn"),
  framedataModeModernBtn: document.getElementById("framedataModeModernBtn"),
  framedataStats: document.getElementById("framedataStats"),
  framedataHint: document.getElementById("framedataHint"),
  framedataHeadRow: document.getElementById("framedataHeadRow"),
  framedataBody: document.getElementById("framedataBody"),
  framedataCharacterDirectory: document.getElementById("framedataCharacterDirectory")
};
