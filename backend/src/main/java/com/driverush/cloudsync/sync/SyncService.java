package com.driverush.cloudsync.sync;

import java.math.BigDecimal;
import java.sql.PreparedStatement;
import java.sql.Statement;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.driverush.cloudsync.common.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SyncService {
  private static final int MAX_SNAPSHOTS_PER_PROFILE = 2;

  private final JdbcTemplate jdbcTemplate;
  private final ObjectMapper objectMapper;

  public SyncService(JdbcTemplate jdbcTemplate, ObjectMapper objectMapper) {
    this.jdbcTemplate = jdbcTemplate;
    this.objectMapper = objectMapper;
  }

  @Transactional
  public Map<String, Object> importPayload(long userId, JsonNode root) {
    if (root == null || !root.isObject()) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "请求体不能为空");
    }
    JsonNode playersNode = root.path("players");
    if (!playersNode.isObject() || playersNode.isEmpty()) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "players 不能为空");
    }

    int profiles = 0;
    int matches = 0;
    int knownReplayIds = 0;
    int snapshots = 0;
    int winrates = 0;
    int leagues = 0;
    int rivals = 0;
    int metrics = 0;
    int snapshotsPruned = 0;
    boolean importedFull = false;

    int profileIndex = 0;
    Iterator<Map.Entry<String, JsonNode>> iterator = playersNode.fields();
    while (iterator.hasNext()) {
      Map.Entry<String, JsonNode> entry = iterator.next();
      JsonNode player = entry.getValue();
      Long sid = asLong(player.path("sid"));
      if (sid == null) {
        sid = parseLongSafe(entry.getKey());
      }
      if (sid == null) {
        continue;
      }
      String playerRequestMode = "minimal".equalsIgnoreCase(text(player, "requestMode")) ? "minimal" : "full";
      if ("full".equals(playerRequestMode)) {
        importedFull = true;
      }

      long profileId = upsertProfile(sid, player);
      upsertBinding(userId, profileId, profileIndex == 0);
      upsertProfileState(profileId, player);
      insertSyncRun(profileId, userId, player);

      matches += upsertMatches(profileId, player.path("matches"));
      knownReplayIds += upsertKnownReplayIds(profileId, player.path("knownReplayIds"));

      Long snapshotId = insertSnapshot(profileId, player.path("playStats"), text(player, "requestMode"), text(player, "lastSyncedAt"));
      if (snapshotId != null) {
        snapshots += 1;
        Map<String, Integer> seasonCount = upsertSeasonData(snapshotId, profileId, player.path("playStats"));
        winrates += seasonCount.getOrDefault("winrates", 0);
        leagues += seasonCount.getOrDefault("leagues", 0);
        rivals += seasonCount.getOrDefault("rivals", 0);
        metrics += upsertMetrics(profileId, snapshotId, player.path("playStats"));
        snapshotsPruned += cleanupOldSnapshots(profileId, MAX_SNAPSHOTS_PER_PROFILE);
      }

      profiles += 1;
      profileIndex += 1;
    }

    if (profiles > 0 && importedFull) {
      updateBootstrapStateInternal(userId, false, "full-sync-uploaded");
    }

    Map<String, Object> counts = new HashMap<>();
    counts.put("profiles", profiles);
    counts.put("matches", matches);
    counts.put("knownReplayIds", knownReplayIds);
    counts.put("snapshots", snapshots);
    counts.put("winrates", winrates);
    counts.put("leagues", leagues);
    counts.put("rivals", rivals);
    counts.put("metrics", metrics);
    counts.put("snapshotsPruned", snapshotsPruned);

    return Map.of(
      "ok", true,
      "imported", counts
    );
  }

  @Transactional(readOnly = true)
  public Map<String, Object> exportPayload(long userId) {
    List<Map<String, Object>> profileRows = jdbcTemplate.queryForList(
      "SELECT p.id, p.sid, p.default_locale, p.source_url, p.build_id, p.last_synced_at " +
        "FROM sf6_profiles p " +
        "JOIN user_sf6_profile_bindings b ON b.profile_id = p.id " +
        "WHERE b.user_id = ? AND b.track_enabled = 1 " +
        "ORDER BY b.is_primary DESC, p.id DESC",
      userId
    );

    Map<String, Object> players = new LinkedHashMap<>();
    String latestSid = null;
    Instant latestSyncedAt = null;

    for (Map<String, Object> profile : profileRows) {
      long profileId = ((Number) profile.get("id")).longValue();
      long sidNum = ((Number) profile.get("sid")).longValue();
      String sid = Long.toString(sidNum);

      Map<String, Object> player = new LinkedHashMap<>();
      player.put("sid", sidNum);
      player.put("locale", objectAsString(profile.get("default_locale")));
      player.put("sourceUrl", objectAsString(profile.get("source_url")));
      player.put("buildId", objectAsString(profile.get("build_id")));
      player.put("lastSyncedAt", timeObjectToIso(profile.get("last_synced_at")));

      Map<String, Object> state = queryOptionalOne(
        "SELECT total_matches, wins, losses, draws, win_rate, new_added, request_mode, play_sync_error FROM sf6_profile_state WHERE profile_id = ?",
        profileId
      );
      if (state != null) {
        player.put("totalMatches", intOrZero(numberValue(state.get("total_matches"))));
        player.put("wins", intOrZero(numberValue(state.get("wins"))));
        player.put("losses", intOrZero(numberValue(state.get("losses"))));
        player.put("draws", intOrZero(numberValue(state.get("draws"))));
        player.put("winRate", decimalOrNull(state.get("win_rate")));
        player.put("newAdded", intOrZero(numberValue(state.get("new_added"))));
        player.put("requestMode", objectAsString(state.get("request_mode")));
        player.put("playSyncError", objectAsString(state.get("play_sync_error")));
      }

      List<Map<String, Object>> matches = jdbcTemplate.queryForList(
        "SELECT replay_id, result, raw_result_json, mode_text, played_at, my_character_name, opponent_character_name, opponent_name, my_league_point, my_master_rating, league_point_delta, master_rating_delta " +
          "FROM sf6_matches WHERE profile_id = ? ORDER BY played_at DESC, id DESC",
        profileId
      );
      List<Map<String, Object>> matchList = new ArrayList<>();
      for (Map<String, Object> row : matches) {
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("id", objectAsString(row.get("replay_id")));
        item.put("result", objectAsString(row.get("result")));
        item.put("rawResult", jsonStringOrNull(row.get("raw_result_json")));
        item.put("mode", objectAsString(row.get("mode_text")));
        item.put("playedAt", timeObjectToIso(row.get("played_at")));
        item.put("myCharacter", objectAsString(row.get("my_character_name")));
        item.put("opponentCharacter", objectAsString(row.get("opponent_character_name")));
        item.put("opponentName", objectAsString(row.get("opponent_name")));
        item.put("myLeaguePoint", integerOrNull(row.get("my_league_point")));
        item.put("myMasterRating", integerOrNull(row.get("my_master_rating")));
        item.put("leaguePointDelta", integerOrNull(row.get("league_point_delta")));
        item.put("masterRatingDelta", integerOrNull(row.get("master_rating_delta")));
        matchList.add(item);
      }
      player.put("matches", matchList);

      List<Map<String, Object>> replayRows = jdbcTemplate.queryForList(
        "SELECT replay_id FROM sf6_known_replay_ids WHERE profile_id = ? ORDER BY created_at DESC",
        profileId
      );
      List<String> replayIds = new ArrayList<>();
      for (Map<String, Object> row : replayRows) {
        replayIds.add(objectAsString(row.get("replay_id")));
      }
      player.put("knownReplayIds", replayIds);

      Map<String, Object> snapshot = queryOptionalOne(
        "SELECT id, request_mode, fetched_at, current_season_id, season_ids_json, base_info_json, battle_stats_json, battle_stats_raw_json, warnings_json " +
          "FROM sf6_play_stats_snapshots WHERE profile_id = ? ORDER BY created_at DESC, id DESC LIMIT 1",
        profileId
      );
      if (snapshot != null) {
        long snapshotId = ((Number) snapshot.get("id")).longValue();
        Map<String, Object> playStats = new LinkedHashMap<>();
        playStats.put("fetchedAt", timeObjectToIso(snapshot.get("fetched_at")));
        playStats.put("currentSeasonId", integerOrNull(snapshot.get("current_season_id")));
        playStats.put("seasonIds", parseJsonAsList(snapshot.get("season_ids_json")));
        playStats.put("baseInfo", parseJsonAsMap(snapshot.get("base_info_json")));
        playStats.put("battleStats", parseJsonAsMap(snapshot.get("battle_stats_json")));
        playStats.put("battleStatsRaw", parseJsonAsMap(snapshot.get("battle_stats_raw_json")));
        playStats.put("warnings", parseJsonAsList(snapshot.get("warnings_json")));
        playStats.put("requestMode", objectAsString(snapshot.get("request_mode")));
        playStats.put("seasons", buildSeasons(snapshotId));
        player.put("playStats", playStats);
      }

      players.put(sid, player);

      Instant profileSyncedAt = toInstant(profile.get("last_synced_at"));
      if (latestSyncedAt == null || (profileSyncedAt != null && profileSyncedAt.isAfter(latestSyncedAt))) {
        latestSyncedAt = profileSyncedAt;
        latestSid = sid;
      }
    }

    Map<String, Object> syncState = new LinkedHashMap<>();
    syncState.put("running", false);
    syncState.put("phase", "done");
    syncState.put("sid", latestSid);
    syncState.put("completedAt", latestSyncedAt == null ? null : latestSyncedAt.toString());
    Map<String, Object> bootstrap = queryBootstrapState(userId);
    syncState.put("fullSyncRequired", bootstrap.get("fullSyncRequired"));

    return Map.of(
      "ok", true,
      "players", players,
      "syncState", syncState,
      "parseDebug", Map.of(),
      "bootstrap", bootstrap
    );
  }

  @Transactional(readOnly = true)
  public Map<String, Object> getBootstrapState(long userId) {
    Map<String, Object> state = queryBootstrapState(userId);
    return Map.of(
      "ok", true,
      "fullSyncRequired", state.get("fullSyncRequired"),
      "reason", state.get("reason"),
      "updatedAt", state.get("updatedAt")
    );
  }

  @Transactional
  public Map<String, Object> updateBootstrapState(long userId, boolean fullSyncRequired, String reason) {
    updateBootstrapStateInternal(userId, fullSyncRequired, reason);
    return getBootstrapState(userId);
  }

  private Map<String, Object> buildSeasons(long snapshotId) {
    Map<String, Object> seasons = new LinkedHashMap<>();

    List<Map<String, Object>> leagueRows = jdbcTemplate.queryForList(
      "SELECT season_id, character_id, character_tool_name, character_name, character_alpha, character_sort, is_played, league_point, league_rank, master_league, master_rating, master_rating_ranking " +
        "FROM sf6_season_character_leagues WHERE snapshot_id = ?",
      snapshotId
    );
    for (Map<String, Object> row : leagueRows) {
      String seasonKey = Integer.toString(((Number) row.get("season_id")).intValue());
      Map<String, Object> season = ensureSeasonContainer(seasons, seasonKey);
      @SuppressWarnings("unchecked")
      List<Map<String, Object>> leagues = (List<Map<String, Object>>) season.get("leagueInfos");
      Map<String, Object> item = new LinkedHashMap<>();
      item.put("character_id", integerOrNull(row.get("character_id")));
      item.put("character_tool_name", objectAsString(row.get("character_tool_name")));
      item.put("character_name", objectAsString(row.get("character_name")));
      item.put("character_alpha", objectAsString(row.get("character_alpha")));
      item.put("character_sort", integerOrNull(row.get("character_sort")));
      item.put("is_played", boolFromObject(row.get("is_played")));
      Map<String, Object> leagueInfo = new LinkedHashMap<>();
      leagueInfo.put("league_point", integerOrNull(row.get("league_point")));
      leagueInfo.put("league_rank", integerOrNull(row.get("league_rank")));
      leagueInfo.put("master_league", integerOrNull(row.get("master_league")));
      leagueInfo.put("master_rating", integerOrNull(row.get("master_rating")));
      leagueInfo.put("master_rating_ranking", integerOrNull(row.get("master_rating_ranking")));
      item.put("league_info", leagueInfo);
      leagues.add(item);
    }

    List<Map<String, Object>> winRows = jdbcTemplate.queryForList(
      "SELECT season_id, mode_id, character_id, character_tool_name, character_name, character_alpha, character_sort, battle_count, win_count " +
        "FROM sf6_season_character_winrates WHERE snapshot_id = ?",
      snapshotId
    );
    for (Map<String, Object> row : winRows) {
      String seasonKey = Integer.toString(((Number) row.get("season_id")).intValue());
      String modeKey = Integer.toString(((Number) row.get("mode_id")).intValue());
      Map<String, Object> season = ensureSeasonContainer(seasons, seasonKey);
      @SuppressWarnings("unchecked")
      Map<String, List<Map<String, Object>>> winByMode = (Map<String, List<Map<String, Object>>>) season.get("winRatesByMode");
      List<Map<String, Object>> list = winByMode.computeIfAbsent(modeKey, k -> new ArrayList<>());
      Map<String, Object> item = new LinkedHashMap<>();
      item.put("character_id", integerOrNull(row.get("character_id")));
      item.put("character_tool_name", objectAsString(row.get("character_tool_name")));
      item.put("character_name", objectAsString(row.get("character_name")));
      item.put("character_alpha", objectAsString(row.get("character_alpha")));
      item.put("character_sort", integerOrNull(row.get("character_sort")));
      item.put("battle_count", intOrZero(numberValue(row.get("battle_count"))));
      item.put("win_count", intOrZero(numberValue(row.get("win_count"))));
      list.add(item);
    }

    List<Map<String, Object>> rivalRows = jdbcTemplate.queryForList(
      "SELECT season_id, mode_id, my_character_tool_name, my_character_name, rival_character_tool_name, rival_character_name, battle_count, win_count " +
        "FROM sf6_season_rival_winrates WHERE snapshot_id = ?",
      snapshotId
    );
    for (Map<String, Object> row : rivalRows) {
      String seasonKey = Integer.toString(((Number) row.get("season_id")).intValue());
      String modeKey = Integer.toString(((Number) row.get("mode_id")).intValue());
      Map<String, Object> season = ensureSeasonContainer(seasons, seasonKey);
      @SuppressWarnings("unchecked")
      Map<String, List<Map<String, Object>>> rivalByMode = (Map<String, List<Map<String, Object>>>) season.get("rivalWinRatesByMode");
      List<Map<String, Object>> modeList = rivalByMode.computeIfAbsent(modeKey, k -> new ArrayList<>());

      String myTool = objectAsString(row.get("my_character_tool_name"));
      Map<String, Object> myEntry = null;
      for (Map<String, Object> one : modeList) {
        if (myTool != null && myTool.equals(one.get("character_tool_name"))) {
          myEntry = one;
          break;
        }
      }
      if (myEntry == null) {
        myEntry = new LinkedHashMap<>();
        myEntry.put("character_tool_name", myTool);
        myEntry.put("character_name", objectAsString(row.get("my_character_name")));
        myEntry.put("character_alpha", objectAsString(row.get("my_character_name")));
        myEntry.put("character_id", null);
        myEntry.put("character_sort", null);
        myEntry.put("rival_character_win_rates", new ArrayList<Map<String, Object>>());
        modeList.add(myEntry);
      }

      @SuppressWarnings("unchecked")
      List<Map<String, Object>> rivalList = (List<Map<String, Object>>) myEntry.get("rival_character_win_rates");
      Map<String, Object> rival = new LinkedHashMap<>();
      rival.put("rival_character_tool_name", objectAsString(row.get("rival_character_tool_name")));
      rival.put("rival_character_name", objectAsString(row.get("rival_character_name")));
      rival.put("rival_character_alpha", objectAsString(row.get("rival_character_name")));
      rival.put("rival_character_id", null);
      rival.put("rival_character_sort", null);
      rival.put("battle_count", intOrZero(numberValue(row.get("battle_count"))));
      rival.put("win_count", intOrZero(numberValue(row.get("win_count"))));
      rivalList.add(rival);
    }

    return seasons;
  }

  private Map<String, Object> ensureSeasonContainer(Map<String, Object> seasons, String seasonKey) {
    @SuppressWarnings("unchecked")
    Map<String, Object> season = (Map<String, Object>) seasons.get(seasonKey);
    if (season != null) {
      return season;
    }
    Map<String, Object> created = new LinkedHashMap<>();
    created.put("seasonId", parseIntSafe(seasonKey));
    created.put("leagueInfos", new ArrayList<Map<String, Object>>());
    created.put("winRatesByMode", new LinkedHashMap<String, List<Map<String, Object>>>());
    created.put("rivalWinRatesByMode", new LinkedHashMap<String, List<Map<String, Object>>>());
    seasons.put(seasonKey, created);
    return created;
  }

  private Map<String, Object> queryOptionalOne(String sql, Object... args) {
    List<Map<String, Object>> list = jdbcTemplate.queryForList(sql, args);
    return list.isEmpty() ? null : list.get(0);
  }

  private Map<String, Object> queryBootstrapState(long userId) {
    Map<String, Object> row = queryOptionalOne(
      "SELECT full_sync_required, full_sync_reason, full_sync_updated_at FROM app_users WHERE id = ? LIMIT 1",
      userId
    );
    if (row == null) {
      throw new ApiException(HttpStatus.UNAUTHORIZED, "User not found.");
    }
    Map<String, Object> state = new LinkedHashMap<>();
    state.put("fullSyncRequired", boolFromObject(row.get("full_sync_required")));
    state.put("reason", objectAsString(row.get("full_sync_reason")) == null ? "" : objectAsString(row.get("full_sync_reason")));
    state.put("updatedAt", timeObjectToIso(row.get("full_sync_updated_at")) == null ? "" : timeObjectToIso(row.get("full_sync_updated_at")));
    return state;
  }

  private void updateBootstrapStateInternal(long userId, boolean fullSyncRequired, String reason) {
    String normalizedReason = objectAsString(reason);
    if (normalizedReason != null && normalizedReason.length() > 128) {
      normalizedReason = normalizedReason.substring(0, 128);
    }
    int updated = jdbcTemplate.update(
      "UPDATE app_users SET full_sync_required = ?, full_sync_reason = ?, full_sync_updated_at = NOW(3), updated_at = NOW(3) WHERE id = ?",
      fullSyncRequired ? 1 : 0,
      normalizedReason,
      userId
    );
    if (updated <= 0) {
      throw new ApiException(HttpStatus.UNAUTHORIZED, "User not found.");
    }
  }

  private long upsertProfile(long sid, JsonNode player) {
    jdbcTemplate.update(
      "INSERT INTO sf6_profiles (sid, default_locale, source_url, build_id, last_synced_at, created_at, updated_at) " +
        "VALUES (?, ?, ?, ?, ?, NOW(3), NOW(3)) " +
        "ON DUPLICATE KEY UPDATE default_locale=VALUES(default_locale), source_url=VALUES(source_url), build_id=VALUES(build_id), last_synced_at=VALUES(last_synced_at), updated_at=NOW(3)",
      sid,
      text(player, "locale"),
      text(player, "sourceUrl"),
      text(player, "buildId"),
      parseTimestamp(text(player, "lastSyncedAt"))
    );
    Long profileId = jdbcTemplate.queryForObject(
      "SELECT id FROM sf6_profiles WHERE sid = ? LIMIT 1",
      Long.class,
      sid
    );
    if (profileId == null) {
      throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "无法创建 sf6 profile");
    }
    return profileId;
  }

  private void upsertBinding(long userId, long profileId, boolean isPrimary) {
    jdbcTemplate.update(
      "INSERT INTO user_sf6_profile_bindings (user_id, profile_id, alias_name, is_primary, track_enabled, created_at, updated_at) " +
        "VALUES (?, ?, NULL, ?, 1, NOW(3), NOW(3)) " +
        "ON DUPLICATE KEY UPDATE is_primary=VALUES(is_primary), track_enabled=1, updated_at=NOW(3)",
      userId, profileId, isPrimary ? 1 : 0
    );
  }

  private void upsertProfileState(long profileId, JsonNode player) {
    jdbcTemplate.update(
      "INSERT INTO sf6_profile_state (profile_id, total_matches, wins, losses, draws, win_rate, new_added, request_mode, play_sync_error, raw_json, updated_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3)) " +
        "ON DUPLICATE KEY UPDATE total_matches=VALUES(total_matches), wins=VALUES(wins), losses=VALUES(losses), draws=VALUES(draws), win_rate=VALUES(win_rate), " +
        "new_added=VALUES(new_added), request_mode=VALUES(request_mode), play_sync_error=VALUES(play_sync_error), raw_json=VALUES(raw_json), updated_at=NOW(3)",
      profileId,
      intOrZero(asLong(player.path("totalMatches"))),
      intOrZero(asLong(player.path("wins"))),
      intOrZero(asLong(player.path("losses"))),
      intOrZero(asLong(player.path("draws"))),
      asBigDecimal(player.path("winRate")),
      intOrZero(asLong(player.path("newAdded"))),
      text(player, "requestMode"),
      text(player, "playSyncError"),
      jsonString(player)
    );
  }

  private void insertSyncRun(long profileId, long userId, JsonNode player) {
    String requestMode = "minimal".equalsIgnoreCase(text(player, "requestMode")) ? "minimal" : "full";
    String warning = null;
    JsonNode playStats = player.path("playStats");
    if (playStats.isObject()) {
      JsonNode warnings = playStats.path("warnings");
      if (warnings.isArray() && !warnings.isEmpty()) {
        warning = warnings.get(0).asText(null);
      }
    }

    jdbcTemplate.update(
      "INSERT INTO sf6_sync_runs (profile_id, triggered_by_user_id, request_mode, status, phase, page_last, page_cap, fetched_count, new_added_count, stop_reason, warning_text, error_text, started_at, completed_at) " +
        "VALUES (?, ?, ?, 'success', 'done', NULL, NULL, ?, ?, 'import-json', ?, ?, ?, ?)",
      profileId,
      userId,
      requestMode,
      intOrZero(asLong(player.path("totalMatches"))),
      intOrZero(asLong(player.path("newAdded"))),
      warning,
      text(player, "playSyncError"),
      parseTimestamp(text(player, "lastSyncedAt")),
      parseTimestamp(text(player, "lastSyncedAt"))
    );
  }

  private int upsertMatches(long profileId, JsonNode matchesNode) {
    if (!matchesNode.isArray()) {
      return 0;
    }
    int count = 0;
    for (JsonNode row : matchesNode) {
      String replayId = text(row, "id");
      if (replayId == null || replayId.isBlank()) {
        continue;
      }
      String result = normalizeResult(text(row, "result"));
      jdbcTemplate.update(
        "INSERT INTO sf6_matches (profile_id, replay_id, played_at, result, raw_result_json, mode_text, my_character_name, opponent_character_name, opponent_name, my_league_point, my_master_rating, league_point_delta, master_rating_delta, created_at, updated_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3), NOW(3)) " +
          "ON DUPLICATE KEY UPDATE played_at=VALUES(played_at), result=VALUES(result), raw_result_json=VALUES(raw_result_json), mode_text=VALUES(mode_text), " +
          "my_character_name=VALUES(my_character_name), opponent_character_name=VALUES(opponent_character_name), opponent_name=VALUES(opponent_name), " +
          "my_league_point=VALUES(my_league_point), my_master_rating=VALUES(my_master_rating), league_point_delta=VALUES(league_point_delta), master_rating_delta=VALUES(master_rating_delta), updated_at=NOW(3)",
        profileId,
        replayId,
        parseTimestamp(text(row, "playedAt")),
        result,
        normalizeRawResultJson(row.path("rawResult")),
        text(row, "mode"),
        text(row, "myCharacter"),
        text(row, "opponentCharacter"),
        text(row, "opponentName"),
        asInteger(row.path("myLeaguePoint")),
        asInteger(row.path("myMasterRating")),
        asInteger(row.path("leaguePointDelta")),
        asInteger(row.path("masterRatingDelta"))
      );
      count += 1;
    }
    return count;
  }

  private int upsertKnownReplayIds(long profileId, JsonNode ids) {
    if (!ids.isArray()) {
      return 0;
    }
    int count = 0;
    for (JsonNode node : ids) {
      String replayId = node.asText("");
      if (replayId.isBlank()) {
        continue;
      }
      jdbcTemplate.update(
        "INSERT IGNORE INTO sf6_known_replay_ids (profile_id, replay_id, created_at) VALUES (?, ?, NOW(3))",
        profileId,
        replayId
      );
      count += 1;
    }
    return count;
  }

  private Long insertSnapshot(long profileId, JsonNode playStats, String fallbackMode, String fallbackTime) {
    if (!playStats.isObject() || playStats.isEmpty()) {
      return null;
    }
    String requestMode = "minimal".equalsIgnoreCase(text(playStats, "requestMode"))
      ? "minimal"
      : ("minimal".equalsIgnoreCase(fallbackMode) ? "minimal" : "full");
    KeyHolder keyHolder = new GeneratedKeyHolder();
    jdbcTemplate.update(connection -> {
      PreparedStatement ps = connection.prepareStatement(
        "INSERT INTO sf6_play_stats_snapshots (profile_id, request_mode, fetched_at, current_season_id, season_ids_json, base_info_json, battle_stats_json, battle_stats_raw_json, warnings_json, created_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3))",
        Statement.RETURN_GENERATED_KEYS
      );
      ps.setLong(1, profileId);
      ps.setString(2, requestMode);
      ps.setTimestamp(3, parseTimestamp(firstNotBlank(text(playStats, "fetchedAt"), fallbackTime)));
      setInteger(ps, 4, asInteger(playStats.path("currentSeasonId")));
      ps.setString(5, jsonString(playStats.path("seasonIds")));
      ps.setString(6, jsonString(playStats.path("baseInfo")));
      ps.setString(7, jsonString(playStats.path("battleStats")));
      ps.setString(8, jsonString(playStats.path("battleStatsRaw")));
      ps.setString(9, jsonString(playStats.path("warnings")));
      return ps;
    }, keyHolder);

    Number key = keyHolder.getKey();
    return key == null ? null : key.longValue();
  }

  private int cleanupOldSnapshots(long profileId, int keepCount) {
    if (keepCount <= 0) {
      return 0;
    }

    List<Long> oldSnapshotIds = jdbcTemplate.queryForList(
      "SELECT id FROM sf6_play_stats_snapshots WHERE profile_id = ? ORDER BY created_at DESC, id DESC LIMIT 100000 OFFSET ?",
      Long.class,
      profileId,
      keepCount
    );
    if (oldSnapshotIds == null || oldSnapshotIds.isEmpty()) {
      return 0;
    }

    StringBuilder sql = new StringBuilder("DELETE FROM sf6_play_stats_snapshots WHERE id IN (");
    for (int i = 0; i < oldSnapshotIds.size(); i += 1) {
      if (i > 0) {
        sql.append(", ");
      }
      sql.append("?");
    }
    sql.append(")");

    Object[] args = oldSnapshotIds.toArray();
    return jdbcTemplate.update(sql.toString(), args);
  }

  private Map<String, Integer> upsertSeasonData(long snapshotId, long profileId, JsonNode playStats) {
    int winrates = 0;
    int leagues = 0;
    int rivals = 0;
    JsonNode seasons = playStats.path("seasons");
    if (!seasons.isObject()) {
      return Map.of("winrates", 0, "leagues", 0, "rivals", 0);
    }

    Iterator<Map.Entry<String, JsonNode>> seasonIter = seasons.fields();
    while (seasonIter.hasNext()) {
      Map.Entry<String, JsonNode> seasonEntry = seasonIter.next();
      Integer seasonId = parseIntSafe(seasonEntry.getKey());
      if (seasonId == null) {
        continue;
      }
      JsonNode season = seasonEntry.getValue();

      JsonNode leagueInfos = season.path("leagueInfos");
      if (leagueInfos.isArray()) {
        for (JsonNode row : leagueInfos) {
          JsonNode leagueInfo = row.path("league_info");
          jdbcTemplate.update(
            "INSERT INTO sf6_season_character_leagues (snapshot_id, profile_id, season_id, character_id, character_tool_name, character_name, character_alpha, character_sort, is_played, league_point, league_rank, master_league, master_rating, master_rating_ranking) " +
              "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
              "ON DUPLICATE KEY UPDATE character_name=VALUES(character_name), character_alpha=VALUES(character_alpha), character_sort=VALUES(character_sort), " +
              "is_played=VALUES(is_played), league_point=VALUES(league_point), league_rank=VALUES(league_rank), master_league=VALUES(master_league), " +
              "master_rating=VALUES(master_rating), master_rating_ranking=VALUES(master_rating_ranking)",
            snapshotId,
            profileId,
            seasonId,
            asInteger(row.path("character_id")),
            text(row, "character_tool_name"),
            firstNotBlank(text(row, "character_name"), text(row, "character_alpha")),
            firstNotBlank(text(row, "character_alpha"), text(row, "character_name")),
            asInteger(row.path("character_sort")),
            boolAsInt(row.path("is_played")),
            asInteger(leagueInfo.path("league_point")),
            asInteger(leagueInfo.path("league_rank")),
            asInteger(leagueInfo.path("master_league")),
            asInteger(leagueInfo.path("master_rating")),
            asInteger(leagueInfo.path("master_rating_ranking"))
          );
          leagues += 1;
        }
      }

      JsonNode winRatesByMode = season.path("winRatesByMode");
      if (winRatesByMode.isObject()) {
        Iterator<Map.Entry<String, JsonNode>> modeIter = winRatesByMode.fields();
        while (modeIter.hasNext()) {
          Map.Entry<String, JsonNode> modeEntry = modeIter.next();
          Integer modeId = parseIntSafe(modeEntry.getKey());
          JsonNode rows = modeEntry.getValue();
          if (modeId == null || !rows.isArray()) {
            continue;
          }
          for (JsonNode row : rows) {
            jdbcTemplate.update(
              "INSERT INTO sf6_season_character_winrates (snapshot_id, profile_id, season_id, mode_id, character_id, character_tool_name, character_name, character_alpha, character_sort, battle_count, win_count) " +
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
                "ON DUPLICATE KEY UPDATE character_name=VALUES(character_name), character_alpha=VALUES(character_alpha), character_sort=VALUES(character_sort), battle_count=VALUES(battle_count), win_count=VALUES(win_count)",
              snapshotId,
              profileId,
              seasonId,
              modeId,
              asInteger(row.path("character_id")),
              text(row, "character_tool_name"),
              firstNotBlank(text(row, "character_name"), text(row, "character_alpha")),
              firstNotBlank(text(row, "character_alpha"), text(row, "character_name")),
              asInteger(row.path("character_sort")),
              intOrZero(asLong(row.path("battle_count"))),
              intOrZero(asLong(row.path("win_count")))
            );
            winrates += 1;
          }
        }
      }

      JsonNode rivalByMode = season.path("rivalWinRatesByMode");
      if (rivalByMode.isObject()) {
        Iterator<Map.Entry<String, JsonNode>> modeIter = rivalByMode.fields();
        while (modeIter.hasNext()) {
          Map.Entry<String, JsonNode> modeEntry = modeIter.next();
          Integer modeId = parseIntSafe(modeEntry.getKey());
          JsonNode rows = modeEntry.getValue();
          if (modeId == null || !rows.isArray()) {
            continue;
          }

          for (JsonNode myRow : rows) {
            String myTool = text(myRow, "character_tool_name");
            String myName = firstNotBlank(text(myRow, "character_name"), text(myRow, "character_alpha"));
            JsonNode rivalsNode = myRow.path("rival_character_win_rates");
            if (!rivalsNode.isArray()) {
              continue;
            }
            for (JsonNode rival : rivalsNode) {
              jdbcTemplate.update(
                "INSERT INTO sf6_season_rival_winrates (snapshot_id, profile_id, season_id, mode_id, my_character_tool_name, my_character_name, rival_character_tool_name, rival_character_name, battle_count, win_count) " +
                  "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
                  "ON DUPLICATE KEY UPDATE my_character_name=VALUES(my_character_name), rival_character_name=VALUES(rival_character_name), battle_count=VALUES(battle_count), win_count=VALUES(win_count)",
                snapshotId,
                profileId,
                seasonId,
                modeId,
                myTool,
                myName,
                text(rival, "rival_character_tool_name"),
                firstNotBlank(text(rival, "rival_character_name"), text(rival, "rival_character_alpha")),
                intOrZero(asLong(rival.path("battle_count"))),
                intOrZero(asLong(rival.path("win_count")))
              );
              rivals += 1;
            }
          }
        }
      }
    }

    return Map.of("winrates", winrates, "leagues", leagues, "rivals", rivals);
  }

  private int upsertMetrics(long profileId, long snapshotId, JsonNode playStats) {
    int count = 0;
    JsonNode battleStats = playStats.path("battleStats");
    JsonNode baseInfo = playStats.path("baseInfo");

    if (baseInfo.isObject()) {
      Iterator<Map.Entry<String, JsonNode>> iter = baseInfo.fields();
      while (iter.hasNext()) {
        Map.Entry<String, JsonNode> e = iter.next();
        upsertMetric(profileId, snapshotId, e.getKey(), e.getValue());
        count += 1;
      }
    }
    if (battleStats.isObject()) {
      Iterator<Map.Entry<String, JsonNode>> iter = battleStats.fields();
      while (iter.hasNext()) {
        Map.Entry<String, JsonNode> e = iter.next();
        upsertMetric(profileId, snapshotId, e.getKey(), e.getValue());
        count += 1;
      }
    }
    return count;
  }

  private void upsertMetric(long profileId, long snapshotId, String key, JsonNode value) {
    if (key == null || key.isBlank() || value == null || value.isNull()) {
      return;
    }
    String valueType;
    BigDecimal num = null;
    String text = null;
    Integer bool = null;

    if (value.isBoolean()) {
      valueType = "bool";
      bool = value.asBoolean() ? 1 : 0;
    } else if (value.isNumber()) {
      valueType = "number";
      num = value.decimalValue();
    } else if (value.isTextual()) {
      String raw = value.asText("");
      if (raw.isBlank()) {
        valueType = "text";
        text = "";
      } else {
        try {
          num = new BigDecimal(raw.trim());
          valueType = "number";
        } catch (Exception ignored) {
          valueType = "text";
          text = raw;
        }
      }
    } else {
      valueType = "text";
      text = value.toString();
    }

    jdbcTemplate.update(
      "INSERT INTO sf6_achievement_metrics_latest (profile_id, metric_key, metric_value_num, metric_value_text, metric_value_bool, value_type, snapshot_id, updated_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, NOW(3)) " +
        "ON DUPLICATE KEY UPDATE metric_value_num=VALUES(metric_value_num), metric_value_text=VALUES(metric_value_text), metric_value_bool=VALUES(metric_value_bool), " +
        "value_type=VALUES(value_type), snapshot_id=VALUES(snapshot_id), updated_at=NOW(3)",
      profileId,
      key,
      num,
      text,
      bool,
      valueType,
      snapshotId
    );
  }

  private String normalizeResult(String result) {
    if (result == null) {
      return "unknown";
    }
    return switch (result) {
      case "win", "loss", "draw", "unknown" -> result;
      default -> "unknown";
    };
  }

  private String normalizeRawResultJson(JsonNode node) {
    if (node == null || node.isMissingNode() || node.isNull()) {
      return null;
    }
    if (node.isTextual()) {
      String raw = node.asText("").trim();
      if (raw.isBlank()) {
        return null;
      }
      try {
        JsonNode parsed = objectMapper.readTree(raw);
        return objectMapper.writeValueAsString(parsed);
      } catch (Exception ignore) {
        return jsonString(node);
      }
    }
    return jsonString(node);
  }

  private String jsonString(JsonNode node) {
    if (node == null || node.isMissingNode() || node.isNull()) {
      return null;
    }
    try {
      return objectMapper.writeValueAsString(node);
    } catch (Exception ex) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "JSON 序列化失败");
    }
  }

  private Timestamp parseTimestamp(String value) {
    if (value == null || value.isBlank()) {
      return null;
    }
    try {
      return Timestamp.from(Instant.parse(value));
    } catch (Exception ignore) {
    }
    try {
      return Timestamp.from(OffsetDateTime.parse(value).toInstant());
    } catch (Exception ignore) {
    }
    try {
      LocalDateTime ldt = LocalDateTime.parse(value);
      return Timestamp.valueOf(ldt);
    } catch (Exception ignore) {
    }
    return null;
  }

  private String text(JsonNode node, String field) {
    if (node == null || !node.has(field) || node.get(field).isNull()) {
      return null;
    }
    String value = node.get(field).asText("");
    return value.isBlank() ? null : value;
  }

  private String firstNotBlank(String a, String b) {
    if (a != null && !a.isBlank()) {
      return a;
    }
    if (b != null && !b.isBlank()) {
      return b;
    }
    return null;
  }

  private Long asLong(JsonNode node) {
    if (node == null || node.isNull() || node.isMissingNode()) {
      return null;
    }
    if (node.isNumber()) {
      return node.longValue();
    }
    if (node.isTextual()) {
      return parseLongSafe(node.asText());
    }
    return null;
  }

  private Integer asInteger(JsonNode node) {
    Long value = asLong(node);
    return value == null ? null : value.intValue();
  }

  private BigDecimal asBigDecimal(JsonNode node) {
    if (node == null || node.isNull() || node.isMissingNode()) {
      return null;
    }
    if (node.isNumber()) {
      return node.decimalValue();
    }
    if (node.isTextual()) {
      try {
        return new BigDecimal(node.asText("").trim());
      } catch (Exception ignore) {
        return null;
      }
    }
    return null;
  }

  private Long parseLongSafe(String value) {
    if (value == null || value.isBlank()) {
      return null;
    }
    try {
      return Long.parseLong(value.trim());
    } catch (Exception ignore) {
      return null;
    }
  }

  private Integer parseIntSafe(String value) {
    if (value == null || value.isBlank()) {
      return null;
    }
    try {
      return Integer.parseInt(value.trim());
    } catch (Exception ignore) {
      return null;
    }
  }

  private int boolAsInt(JsonNode node) {
    return node != null && node.asBoolean(false) ? 1 : 0;
  }

  private int intOrZero(Long value) {
    return value == null ? 0 : value.intValue();
  }

  private String objectAsString(Object value) {
    if (value == null) {
      return null;
    }
    String text = String.valueOf(value);
    return text.isBlank() ? null : text;
  }

  private String timestampToIso(Timestamp timestamp) {
    if (timestamp == null) {
      return null;
    }
    return timestamp.toInstant().toString();
  }

  private String timeObjectToIso(Object value) {
    Instant instant = toInstant(value);
    return instant == null ? null : instant.toString();
  }

  private Instant toInstant(Object value) {
    if (value == null) {
      return null;
    }
    if (value instanceof Instant i) {
      return i;
    }
    if (value instanceof Timestamp t) {
      return t.toInstant();
    }
    if (value instanceof LocalDateTime ldt) {
      return ldt.atZone(ZoneId.systemDefault()).toInstant();
    }
    if (value instanceof OffsetDateTime odt) {
      return odt.toInstant();
    }
    if (value instanceof java.util.Date d) {
      return d.toInstant();
    }
    String text = String.valueOf(value).trim();
    if (text.isBlank()) {
      return null;
    }
    try {
      return Instant.parse(text);
    } catch (Exception ignore) {
    }
    try {
      return OffsetDateTime.parse(text).toInstant();
    } catch (Exception ignore) {
    }
    try {
      return LocalDateTime.parse(text).atZone(ZoneId.systemDefault()).toInstant();
    } catch (Exception ignore) {
    }
    return null;
  }

  private Integer integerOrNull(Object value) {
    Long num = numberValue(value);
    return num == null ? null : num.intValue();
  }

  private Long numberValue(Object value) {
    if (value == null) {
      return null;
    }
    if (value instanceof Number n) {
      return n.longValue();
    }
    try {
      return Long.parseLong(String.valueOf(value).trim());
    } catch (Exception ignore) {
      return null;
    }
  }

  private BigDecimal decimalOrNull(Object value) {
    if (value == null) {
      return null;
    }
    if (value instanceof BigDecimal decimal) {
      return decimal;
    }
    if (value instanceof Number n) {
      return BigDecimal.valueOf(n.doubleValue());
    }
    try {
      return new BigDecimal(String.valueOf(value).trim());
    } catch (Exception ignore) {
      return null;
    }
  }

  private boolean boolFromObject(Object value) {
    if (value == null) {
      return false;
    }
    if (value instanceof Boolean b) {
      return b;
    }
    if (value instanceof Number n) {
      return n.intValue() != 0;
    }
    String text = String.valueOf(value).trim().toLowerCase();
    return "1".equals(text) || "true".equals(text) || "yes".equals(text);
  }

  private String jsonStringOrNull(Object value) {
    if (value == null) {
      return null;
    }
    if (value instanceof String s) {
      return s;
    }
    try {
      return objectMapper.writeValueAsString(value);
    } catch (Exception ignore) {
      return String.valueOf(value);
    }
  }

  private Map<String, Object> parseJsonAsMap(Object value) {
    if (value == null) {
      return new LinkedHashMap<>();
    }
    try {
      JsonNode node = value instanceof JsonNode j ? j : objectMapper.readTree(String.valueOf(value));
      if (!node.isObject()) {
        return new LinkedHashMap<>();
      }
      @SuppressWarnings("unchecked")
      Map<String, Object> map = objectMapper.convertValue(node, Map.class);
      return map == null ? new LinkedHashMap<>() : map;
    } catch (Exception ignore) {
      return new LinkedHashMap<>();
    }
  }

  private List<Object> parseJsonAsList(Object value) {
    if (value == null) {
      return new ArrayList<>();
    }
    try {
      JsonNode node = value instanceof JsonNode j ? j : objectMapper.readTree(String.valueOf(value));
      if (!node.isArray()) {
        return new ArrayList<>();
      }
      @SuppressWarnings("unchecked")
      List<Object> list = objectMapper.convertValue(node, List.class);
      return list == null ? new ArrayList<>() : list;
    } catch (Exception ignore) {
      return new ArrayList<>();
    }
  }

  private void setInteger(PreparedStatement ps, int index, Integer value) throws java.sql.SQLException {
    if (value == null) {
      ps.setNull(index, java.sql.Types.INTEGER);
    } else {
      ps.setInt(index, value);
    }
  }
}
