/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const mysql = require("C:/Users/10218/.codex/vendor_imports/dbhub-node22/node_modules/mysql2/promise");

const DEFAULT_JSON_PATH = "C:/Users/10218/Downloads/sf6-buckler/sf6-buckler-latest.json";

function toDate(value) {
  if (!value) {
    return null;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  return d;
}

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function detectValueType(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "boolean") {
    return "bool";
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return "number";
  }
  if (typeof value === "string") {
    const t = value.trim();
    if (!t) {
      return "text";
    }
    const n = Number(t);
    return Number.isFinite(n) ? "number" : "text";
  }
  return "text";
}

function normalizeMetric(value) {
  const vt = detectValueType(value);
  if (!vt) {
    return null;
  }
  if (vt === "bool") {
    return {
      valueType: "bool",
      num: null,
      text: null,
      bool: value ? 1 : 0
    };
  }
  if (vt === "number") {
    return {
      valueType: "number",
      num: Number(value),
      text: null,
      bool: null
    };
  }
  return {
    valueType: "text",
    num: null,
    text: String(value),
    bool: null
  };
}

async function ensureSchema(conn) {
  const ddl = `
CREATE TABLE IF NOT EXISTS app_users (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  email VARCHAR(191) NOT NULL,
  username VARCHAR(64) NULL,
  password_hash VARCHAR(255) NOT NULL,
  status ENUM('active','disabled') NOT NULL DEFAULT 'active',
  last_login_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_app_users_email (email),
  UNIQUE KEY uq_app_users_username (username)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS app_user_profiles (
  user_id BIGINT UNSIGNED PRIMARY KEY,
  display_name VARCHAR(80) NULL,
  avatar_url VARCHAR(255) NULL,
  locale VARCHAR(16) NOT NULL DEFAULT 'zh-hans',
  timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Shanghai',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_user_profiles_user FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sf6_profiles (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  sid BIGINT UNSIGNED NOT NULL,
  fighter_id VARCHAR(64) NULL,
  default_locale VARCHAR(16) NULL,
  source_url VARCHAR(512) NULL,
  build_id VARCHAR(64) NULL,
  last_synced_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_sf6_profiles_sid (sid)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS user_sf6_profile_bindings (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  profile_id BIGINT UNSIGNED NOT NULL,
  alias_name VARCHAR(80) NULL,
  is_primary TINYINT(1) NOT NULL DEFAULT 0,
  track_enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_user_profile (user_id, profile_id),
  KEY idx_binding_user (user_id, is_primary),
  CONSTRAINT fk_binding_user FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE,
  CONSTRAINT fk_binding_profile FOREIGN KEY (profile_id) REFERENCES sf6_profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sf6_profile_state (
  profile_id BIGINT UNSIGNED PRIMARY KEY,
  total_matches INT NOT NULL DEFAULT 0,
  wins INT NOT NULL DEFAULT 0,
  losses INT NOT NULL DEFAULT 0,
  draws INT NOT NULL DEFAULT 0,
  win_rate DECIMAL(6,2) NULL,
  new_added INT NOT NULL DEFAULT 0,
  request_mode VARCHAR(16) NULL,
  play_sync_error VARCHAR(500) NULL,
  raw_json JSON NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_profile_state_profile FOREIGN KEY (profile_id) REFERENCES sf6_profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sf6_sync_runs (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  profile_id BIGINT UNSIGNED NOT NULL,
  triggered_by_user_id BIGINT UNSIGNED NULL,
  request_mode ENUM('full','minimal') NOT NULL,
  status ENUM('running','success','failed') NOT NULL,
  phase VARCHAR(32) NULL,
  page_last INT NULL,
  page_cap INT NULL,
  fetched_count INT NOT NULL DEFAULT 0,
  new_added_count INT NOT NULL DEFAULT 0,
  stop_reason VARCHAR(64) NULL,
  warning_text VARCHAR(255) NULL,
  error_text VARCHAR(500) NULL,
  started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  completed_at DATETIME(3) NULL,
  KEY idx_sync_profile_time (profile_id, started_at DESC),
  KEY idx_sync_status (status, started_at DESC),
  CONSTRAINT fk_sync_profile FOREIGN KEY (profile_id) REFERENCES sf6_profiles(id) ON DELETE CASCADE,
  CONSTRAINT fk_sync_user FOREIGN KEY (triggered_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sf6_matches (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  profile_id BIGINT UNSIGNED NOT NULL,
  replay_id VARCHAR(40) NOT NULL,
  played_at DATETIME(3) NULL,
  result ENUM('win','loss','draw','unknown') NOT NULL DEFAULT 'unknown',
  raw_result_json JSON NULL,
  mode_text VARCHAR(64) NULL,
  my_character_name VARCHAR(64) NULL,
  opponent_character_name VARCHAR(64) NULL,
  opponent_name VARCHAR(64) NULL,
  my_league_point INT NULL,
  my_master_rating INT NULL,
  league_point_delta INT NULL,
  master_rating_delta INT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_profile_replay (profile_id, replay_id),
  KEY idx_matches_profile_time (profile_id, played_at DESC),
  KEY idx_matches_profile_mode_time (profile_id, mode_text, played_at DESC),
  CONSTRAINT fk_matches_profile FOREIGN KEY (profile_id) REFERENCES sf6_profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sf6_known_replay_ids (
  profile_id BIGINT UNSIGNED NOT NULL,
  replay_id VARCHAR(40) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (profile_id, replay_id),
  CONSTRAINT fk_known_replay_profile FOREIGN KEY (profile_id) REFERENCES sf6_profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sf6_play_stats_snapshots (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  profile_id BIGINT UNSIGNED NOT NULL,
  request_mode ENUM('full','minimal') NOT NULL,
  fetched_at DATETIME(3) NULL,
  current_season_id INT NULL,
  season_ids_json JSON NULL,
  base_info_json JSON NULL,
  battle_stats_json JSON NULL,
  battle_stats_raw_json JSON NULL,
  warnings_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_snapshot_profile_time (profile_id, created_at DESC),
  CONSTRAINT fk_snapshot_profile FOREIGN KEY (profile_id) REFERENCES sf6_profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sf6_season_character_winrates (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  snapshot_id BIGINT UNSIGNED NOT NULL,
  profile_id BIGINT UNSIGNED NOT NULL,
  season_id INT NOT NULL,
  mode_id TINYINT UNSIGNED NOT NULL,
  character_id INT NULL,
  character_tool_name VARCHAR(64) NOT NULL,
  character_name VARCHAR(64) NULL,
  character_alpha VARCHAR(64) NULL,
  character_sort INT NULL,
  battle_count INT NOT NULL DEFAULT 0,
  win_count INT NOT NULL DEFAULT 0,
  UNIQUE KEY uq_winrate_row (snapshot_id, season_id, mode_id, character_tool_name),
  KEY idx_winrate_profile_lookup (profile_id, season_id, mode_id, battle_count DESC),
  CONSTRAINT fk_winrate_snapshot FOREIGN KEY (snapshot_id) REFERENCES sf6_play_stats_snapshots(id) ON DELETE CASCADE,
  CONSTRAINT fk_winrate_profile FOREIGN KEY (profile_id) REFERENCES sf6_profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sf6_season_character_leagues (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  snapshot_id BIGINT UNSIGNED NOT NULL,
  profile_id BIGINT UNSIGNED NOT NULL,
  season_id INT NOT NULL,
  character_id INT NULL,
  character_tool_name VARCHAR(64) NOT NULL,
  character_name VARCHAR(64) NULL,
  character_alpha VARCHAR(64) NULL,
  character_sort INT NULL,
  is_played TINYINT(1) NOT NULL DEFAULT 0,
  league_point INT NULL,
  league_rank INT NULL,
  master_league INT NULL,
  master_rating INT NULL,
  master_rating_ranking INT NULL,
  UNIQUE KEY uq_league_row (snapshot_id, season_id, character_tool_name),
  KEY idx_league_profile_lookup (profile_id, season_id, league_point DESC, master_rating DESC),
  CONSTRAINT fk_league_snapshot FOREIGN KEY (snapshot_id) REFERENCES sf6_play_stats_snapshots(id) ON DELETE CASCADE,
  CONSTRAINT fk_league_profile FOREIGN KEY (profile_id) REFERENCES sf6_profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sf6_season_rival_winrates (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  snapshot_id BIGINT UNSIGNED NOT NULL,
  profile_id BIGINT UNSIGNED NOT NULL,
  season_id INT NOT NULL,
  mode_id TINYINT UNSIGNED NOT NULL,
  my_character_tool_name VARCHAR(64) NOT NULL,
  my_character_name VARCHAR(64) NULL,
  rival_character_tool_name VARCHAR(64) NOT NULL,
  rival_character_name VARCHAR(64) NULL,
  battle_count INT NOT NULL DEFAULT 0,
  win_count INT NOT NULL DEFAULT 0,
  UNIQUE KEY uq_rival_row (snapshot_id, season_id, mode_id, my_character_tool_name, rival_character_tool_name),
  KEY idx_rival_profile_lookup (profile_id, season_id, mode_id, my_character_tool_name, battle_count DESC),
  CONSTRAINT fk_rival_snapshot FOREIGN KEY (snapshot_id) REFERENCES sf6_play_stats_snapshots(id) ON DELETE CASCADE,
  CONSTRAINT fk_rival_profile FOREIGN KEY (profile_id) REFERENCES sf6_profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sf6_achievement_metrics_latest (
  profile_id BIGINT UNSIGNED NOT NULL,
  metric_key VARCHAR(100) NOT NULL,
  metric_value_num DECIMAL(20,6) NULL,
  metric_value_text VARCHAR(255) NULL,
  metric_value_bool TINYINT(1) NULL,
  value_type ENUM('number','text','bool') NOT NULL,
  snapshot_id BIGINT UNSIGNED NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (profile_id, metric_key),
  KEY idx_achievement_snapshot (snapshot_id),
  CONSTRAINT fk_achievement_profile FOREIGN KEY (profile_id) REFERENCES sf6_profiles(id) ON DELETE CASCADE,
  CONSTRAINT fk_achievement_snapshot FOREIGN KEY (snapshot_id) REFERENCES sf6_play_stats_snapshots(id) ON DELETE CASCADE
) ENGINE=InnoDB;
`;
  await conn.query(ddl);
}

async function upsertSeedUser(conn) {
  const email = "local-import@drive-rush.local";
  const username = "local_import";
  const passwordHash = "LOCAL_IMPORT_NO_LOGIN";
  await conn.execute(
    `INSERT INTO app_users (email, username, password_hash, status)
     VALUES (?, ?, ?, 'active')
     ON DUPLICATE KEY UPDATE username = VALUES(username), status = 'active'`,
    [email, username, passwordHash]
  );
  const [[user]] = await conn.execute("SELECT id FROM app_users WHERE email = ? LIMIT 1", [email]);
  await conn.execute(
    `INSERT INTO app_user_profiles (user_id, display_name, locale, timezone)
     VALUES (?, ?, 'zh-hans', 'Asia/Shanghai')
     ON DUPLICATE KEY UPDATE display_name = VALUES(display_name)`,
    [user.id, "本地导入用户"]
  );
  return user.id;
}

async function upsertProfile(conn, sid, player) {
  await conn.execute(
    `INSERT INTO sf6_profiles (sid, default_locale, source_url, build_id, last_synced_at)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       default_locale = VALUES(default_locale),
       source_url = VALUES(source_url),
       build_id = VALUES(build_id),
       last_synced_at = VALUES(last_synced_at)`,
    [
      asNumber(sid),
      player.locale || null,
      player.sourceUrl || null,
      player.buildId || null,
      toDate(player.lastSyncedAt)
    ]
  );
  const [[row]] = await conn.execute("SELECT id FROM sf6_profiles WHERE sid = ? LIMIT 1", [asNumber(sid)]);
  return row.id;
}

async function upsertBinding(conn, userId, profileId, isPrimary) {
  await conn.execute(
    `INSERT INTO user_sf6_profile_bindings (user_id, profile_id, alias_name, is_primary, track_enabled)
     VALUES (?, ?, NULL, ?, 1)
     ON DUPLICATE KEY UPDATE is_primary = VALUES(is_primary), track_enabled = 1`,
    [userId, profileId, isPrimary ? 1 : 0]
  );
}

async function upsertProfileState(conn, profileId, player) {
  await conn.execute(
    `INSERT INTO sf6_profile_state (
      profile_id, total_matches, wins, losses, draws, win_rate, new_added, request_mode, play_sync_error, raw_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      total_matches = VALUES(total_matches),
      wins = VALUES(wins),
      losses = VALUES(losses),
      draws = VALUES(draws),
      win_rate = VALUES(win_rate),
      new_added = VALUES(new_added),
      request_mode = VALUES(request_mode),
      play_sync_error = VALUES(play_sync_error),
      raw_json = VALUES(raw_json)`,
    [
      profileId,
      asNumber(player.totalMatches) || 0,
      asNumber(player.wins) || 0,
      asNumber(player.losses) || 0,
      asNumber(player.draws) || 0,
      asNumber(player.winRate),
      asNumber(player.newAdded) || 0,
      player.requestMode || null,
      player.playSyncError || null,
      JSON.stringify(player)
    ]
  );
}

async function insertSyncRun(conn, profileId, userId, player) {
  const mode = String(player.requestMode || "full") === "minimal" ? "minimal" : "full";
  await conn.execute(
    `INSERT INTO sf6_sync_runs (
      profile_id, triggered_by_user_id, request_mode, status, phase, fetched_count, new_added_count,
      warning_text, error_text, started_at, completed_at
    ) VALUES (?, ?, ?, 'success', 'done', ?, ?, NULL, ?, ?, ?)` ,
    [
      profileId,
      userId,
      mode,
      asNumber(player.totalMatches) || 0,
      asNumber(player.newAdded) || 0,
      player.playSyncError || null,
      toDate(player.lastSyncedAt),
      toDate(player.lastSyncedAt)
    ]
  );
}

async function upsertMatches(conn, profileId, matches) {
  const list = Array.isArray(matches) ? matches : [];
  for (const m of list) {
    await conn.execute(
      `INSERT INTO sf6_matches (
        profile_id, replay_id, played_at, result, raw_result_json, mode_text, my_character_name,
        opponent_character_name, opponent_name, my_league_point, my_master_rating, league_point_delta, master_rating_delta
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        played_at = VALUES(played_at),
        result = VALUES(result),
        raw_result_json = VALUES(raw_result_json),
        mode_text = VALUES(mode_text),
        my_character_name = VALUES(my_character_name),
        opponent_character_name = VALUES(opponent_character_name),
        opponent_name = VALUES(opponent_name),
        my_league_point = VALUES(my_league_point),
        my_master_rating = VALUES(my_master_rating),
        league_point_delta = VALUES(league_point_delta),
        master_rating_delta = VALUES(master_rating_delta)`,
      [
        profileId,
        String(m.id || ""),
        toDate(m.playedAt),
        ["win", "loss", "draw", "unknown"].includes(String(m.result || "unknown"))
          ? String(m.result || "unknown")
          : "unknown",
        m.rawResult ? JSON.stringify(m.rawResult) : null,
        m.mode || null,
        m.myCharacter || null,
        m.opponentCharacter || null,
        m.opponentName || null,
        asNumber(m.myLeaguePoint),
        asNumber(m.myMasterRating),
        asNumber(m.leaguePointDelta),
        asNumber(m.masterRatingDelta)
      ]
    );
  }
  return list.length;
}

async function upsertKnownReplayIds(conn, profileId, ids) {
  const list = Array.isArray(ids) ? ids : [];
  for (const rid of list) {
    if (!rid) {
      continue;
    }
    await conn.execute(
      `INSERT IGNORE INTO sf6_known_replay_ids (profile_id, replay_id) VALUES (?, ?)`,
      [profileId, String(rid)]
    );
  }
  return list.length;
}

async function insertSnapshot(conn, profileId, player) {
  const ps = player && player.playStats ? player.playStats : null;
  if (!ps || typeof ps !== "object") {
    return null;
  }
  const mode = String(ps.requestMode || player.requestMode || "full") === "minimal" ? "minimal" : "full";
  const [ret] = await conn.execute(
    `INSERT INTO sf6_play_stats_snapshots (
      profile_id, request_mode, fetched_at, current_season_id, season_ids_json, base_info_json, battle_stats_json, battle_stats_raw_json, warnings_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      profileId,
      mode,
      toDate(ps.fetchedAt || player.lastSyncedAt),
      asNumber(ps.currentSeasonId),
      JSON.stringify(Array.isArray(ps.seasonIds) ? ps.seasonIds : []),
      JSON.stringify(ps.baseInfo || {}),
      JSON.stringify(ps.battleStats || {}),
      JSON.stringify(ps.battleStatsRaw || {}),
      JSON.stringify(Array.isArray(ps.warnings) ? ps.warnings : [])
    ]
  );
  return ret.insertId;
}

async function upsertSeasonData(conn, snapshotId, profileId, player) {
  const ps = player && player.playStats ? player.playStats : null;
  const seasons = ps && ps.seasons && typeof ps.seasons === "object" ? ps.seasons : {};
  let winrateRows = 0;
  let leagueRows = 0;
  let rivalRows = 0;

  for (const [seasonKey, seasonData] of Object.entries(seasons)) {
    const seasonId = asNumber(seasonKey);
    if (seasonId === null) {
      continue;
    }

    const leagueInfos = Array.isArray(seasonData && seasonData.leagueInfos) ? seasonData.leagueInfos : [];
    for (const row of leagueInfos) {
      await conn.execute(
        `INSERT INTO sf6_season_character_leagues (
          snapshot_id, profile_id, season_id, character_id, character_tool_name, character_name, character_alpha, character_sort,
          is_played, league_point, league_rank, master_league, master_rating, master_rating_ranking
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          character_name = VALUES(character_name),
          character_alpha = VALUES(character_alpha),
          character_sort = VALUES(character_sort),
          is_played = VALUES(is_played),
          league_point = VALUES(league_point),
          league_rank = VALUES(league_rank),
          master_league = VALUES(master_league),
          master_rating = VALUES(master_rating),
          master_rating_ranking = VALUES(master_rating_ranking)`,
        [
          snapshotId,
          profileId,
          seasonId,
          asNumber(row.character_id),
          row.character_tool_name || "",
          row.character_name || null,
          row.character_alpha || null,
          asNumber(row.character_sort),
          row.is_played ? 1 : 0,
          asNumber(row.league_info && row.league_info.league_point),
          asNumber(row.league_info && row.league_info.league_rank),
          asNumber(row.league_info && row.league_info.master_league),
          asNumber(row.league_info && row.league_info.master_rating),
          asNumber(row.league_info && row.league_info.master_rating_ranking)
        ]
      );
      leagueRows += 1;
    }

    const winRatesByMode = seasonData && seasonData.winRatesByMode && typeof seasonData.winRatesByMode === "object"
      ? seasonData.winRatesByMode
      : {};
    for (const [modeKey, rows] of Object.entries(winRatesByMode)) {
      const modeId = asNumber(modeKey);
      if (modeId === null || !Array.isArray(rows)) {
        continue;
      }
      for (const row of rows) {
        await conn.execute(
          `INSERT INTO sf6_season_character_winrates (
            snapshot_id, profile_id, season_id, mode_id, character_id, character_tool_name, character_name, character_alpha,
            character_sort, battle_count, win_count
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            character_name = VALUES(character_name),
            character_alpha = VALUES(character_alpha),
            character_sort = VALUES(character_sort),
            battle_count = VALUES(battle_count),
            win_count = VALUES(win_count)`,
          [
            snapshotId,
            profileId,
            seasonId,
            modeId,
            asNumber(row.character_id),
            row.character_tool_name || "",
            row.character_name || null,
            row.character_alpha || null,
            asNumber(row.character_sort),
            asNumber(row.battle_count) || 0,
            asNumber(row.win_count) || 0
          ]
        );
        winrateRows += 1;
      }
    }

    const rivalByMode = seasonData && seasonData.rivalWinRatesByMode && typeof seasonData.rivalWinRatesByMode === "object"
      ? seasonData.rivalWinRatesByMode
      : {};
    for (const [modeKey, rows] of Object.entries(rivalByMode)) {
      const modeId = asNumber(modeKey);
      if (modeId === null || !Array.isArray(rows)) {
        continue;
      }
      for (const myRow of rows) {
        const myTool = myRow.character_tool_name || "";
        const myName = myRow.character_name || myRow.character_alpha || null;
        const rivals = Array.isArray(myRow.rival_character_win_rates) ? myRow.rival_character_win_rates : [];
        for (const r of rivals) {
          await conn.execute(
            `INSERT INTO sf6_season_rival_winrates (
              snapshot_id, profile_id, season_id, mode_id, my_character_tool_name, my_character_name,
              rival_character_tool_name, rival_character_name, battle_count, win_count
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              my_character_name = VALUES(my_character_name),
              rival_character_name = VALUES(rival_character_name),
              battle_count = VALUES(battle_count),
              win_count = VALUES(win_count)`,
            [
              snapshotId,
              profileId,
              seasonId,
              modeId,
              myTool,
              myName,
              r.rival_character_tool_name || "",
              r.rival_character_name || r.rival_character_alpha || null,
              asNumber(r.battle_count) || 0,
              asNumber(r.win_count) || 0
            ]
          );
          rivalRows += 1;
        }
      }
    }
  }
  return { winrateRows, leagueRows, rivalRows };
}

async function upsertMetrics(conn, snapshotId, profileId, player) {
  const ps = player && player.playStats ? player.playStats : {};
  const baseInfo = ps && ps.baseInfo && typeof ps.baseInfo === "object" ? ps.baseInfo : {};
  const battleStats = ps && ps.battleStats && typeof ps.battleStats === "object" ? ps.battleStats : {};
  const source = { ...baseInfo, ...battleStats };
  let count = 0;
  for (const [key, value] of Object.entries(source)) {
    const metric = normalizeMetric(value);
    if (!metric) {
      continue;
    }
    await conn.execute(
      `INSERT INTO sf6_achievement_metrics_latest (
        profile_id, metric_key, metric_value_num, metric_value_text, metric_value_bool, value_type, snapshot_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        metric_value_num = VALUES(metric_value_num),
        metric_value_text = VALUES(metric_value_text),
        metric_value_bool = VALUES(metric_value_bool),
        value_type = VALUES(value_type),
        snapshot_id = VALUES(snapshot_id),
        updated_at = CURRENT_TIMESTAMP(3)`,
      [
        profileId,
        key,
        metric.num,
        metric.text,
        metric.bool,
        metric.valueType,
        snapshotId
      ]
    );
    count += 1;
  }
  return count;
}

async function getTableCounts(conn) {
  const tables = [
    "app_users",
    "sf6_profiles",
    "user_sf6_profile_bindings",
    "sf6_profile_state",
    "sf6_matches",
    "sf6_known_replay_ids",
    "sf6_play_stats_snapshots",
    "sf6_season_character_winrates",
    "sf6_season_character_leagues",
    "sf6_season_rival_winrates",
    "sf6_achievement_metrics_latest",
    "sf6_sync_runs"
  ];
  const result = {};
  for (const t of tables) {
    const [[r]] = await conn.query(`SELECT COUNT(*) AS c FROM ${t}`);
    result[t] = r.c;
  }
  return result;
}

async function main() {
  const jsonPath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_JSON_PATH;
  if (!fs.existsSync(jsonPath)) {
    throw new Error(`JSON file not found: ${jsonPath}`);
  }

  const payload = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const players = payload && typeof payload === "object" && payload.players && typeof payload.players === "object"
    ? payload.players
    : {};
  const sids = Object.keys(players);
  if (!sids.length) {
    throw new Error("No players found in JSON payload.");
  }

  const conn = await mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "",
    database: "drive-rush",
    port: 3306,
    multipleStatements: true
  });

  try {
    await ensureSchema(conn);
    const userId = await upsertSeedUser(conn);
    let profileIdx = 0;

    const stats = {
      profiles: 0,
      matches: 0,
      knownReplayIds: 0,
      snapshots: 0,
      winrates: 0,
      leagues: 0,
      rivals: 0,
      metrics: 0
    };

    for (const sid of sids) {
      const player = players[sid] || {};
      const profileId = await upsertProfile(conn, sid, player);
      await upsertBinding(conn, userId, profileId, profileIdx === 0);
      await upsertProfileState(conn, profileId, player);
      await insertSyncRun(conn, profileId, userId, player);

      stats.matches += await upsertMatches(conn, profileId, player.matches || []);
      stats.knownReplayIds += await upsertKnownReplayIds(conn, profileId, player.knownReplayIds || []);

      const snapshotId = await insertSnapshot(conn, profileId, player);
      if (snapshotId) {
        stats.snapshots += 1;
        const seasonStats = await upsertSeasonData(conn, snapshotId, profileId, player);
        stats.winrates += seasonStats.winrateRows;
        stats.leagues += seasonStats.leagueRows;
        stats.rivals += seasonStats.rivalRows;
        stats.metrics += await upsertMetrics(conn, snapshotId, profileId, player);
      }

      stats.profiles += 1;
      profileIdx += 1;
    }

    const tableCounts = await getTableCounts(conn);
    console.log(JSON.stringify({
      sourceFile: jsonPath,
      imported: stats,
      tableCounts
    }, null, 2));
  } finally {
    await conn.end();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
