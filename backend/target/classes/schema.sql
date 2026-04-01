CREATE TABLE IF NOT EXISTS app_users (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT COMMENT '鐢ㄦ埛涓婚敭ID',
  email VARCHAR(191) NOT NULL COMMENT '鐧诲綍閭锛堝敮涓€锛?,
  username VARCHAR(64) NULL COMMENT '鐢ㄦ埛鍚嶏紙棰勭暀锛屽彲涓虹┖锛?,
  password_hash VARCHAR(255) NOT NULL COMMENT '瀵嗙爜鍝堝笇锛圔Crypt锛?,
  status ENUM('active', 'disabled') NOT NULL DEFAULT 'active' COMMENT '璐﹀彿鐘舵€侊細active鍚敤/disabled绂佺敤',
  last_login_at DATETIME(3) NULL COMMENT '鏈€杩戠櫥褰曟椂闂?,
  full_sync_required TINYINT(1) NOT NULL DEFAULT 1 COMMENT '鏄惁闇€瑕佸叏閲忓悓姝ワ紙1鏄紝0鍚︼級',
  full_sync_reason VARCHAR(128) NULL COMMENT '鍏ㄩ噺鍚屾鏍囪鍘熷洜',
  full_sync_updated_at DATETIME(3) NULL COMMENT '鍏ㄩ噺鍚屾鏍囪鏇存柊鏃堕棿',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '鍒涘缓鏃堕棿',
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '鏇存柊鏃堕棿',
  UNIQUE KEY uq_app_users_email (email),
  UNIQUE KEY uq_app_users_username (username)
) ENGINE = InnoDB COMMENT='绯荤粺鐢ㄦ埛琛?;

CREATE TABLE IF NOT EXISTS app_user_profiles (
  user_id BIGINT UNSIGNED PRIMARY KEY COMMENT '鐢ㄦ埛ID锛堝叧鑱攁pp_users.id锛?,
  display_name VARCHAR(80) NULL COMMENT '鏄剧ず鍚嶇О',
  avatar_url VARCHAR(255) NULL COMMENT '澶村儚URL',
  locale VARCHAR(16) NOT NULL DEFAULT 'zh-hans' COMMENT '榛樿璇█鍖哄煙',
  timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Shanghai' COMMENT '鏃跺尯',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '鍒涘缓鏃堕棿',
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '鏇存柊鏃堕棿',
  CONSTRAINT fk_user_profiles_user FOREIGN KEY (user_id) REFERENCES app_users (id) ON DELETE CASCADE
) ENGINE = InnoDB COMMENT='鐢ㄦ埛鎵╁睍璧勬枡琛?;

CREATE TABLE IF NOT EXISTS sf6_profiles (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT COMMENT 'SF6妗ｆ涓婚敭ID',
  sid BIGINT UNSIGNED NOT NULL COMMENT 'SF6鐭璉D锛圔uckler鍞竴鐢ㄦ埛鐮侊級',
  fighter_id VARCHAR(64) NULL COMMENT 'Fighter ID锛堝彲閫夛級',
  default_locale VARCHAR(16) NULL COMMENT '榛樿璇█锛坺h-hans/en-us绛夛級',
  source_url VARCHAR(512) NULL COMMENT '鏉ユ簮椤甸潰URL',
  build_id VARCHAR(64) NULL COMMENT 'Buckler鍓嶇buildId',
  last_synced_at DATETIME(3) NULL COMMENT '鏈€杩戝悓姝ユ椂闂达紙鏈湴璁板綍锛?,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '鍒涘缓鏃堕棿',
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '鏇存柊鏃堕棿',
  UNIQUE KEY uq_sf6_profiles_sid (sid)
) ENGINE = InnoDB COMMENT='SF6妗ｆ涓昏〃锛堟寜sid鍞竴锛?;

CREATE TABLE IF NOT EXISTS user_sf6_profile_bindings (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT COMMENT '缁戝畾鍏崇郴涓婚敭ID',
  user_id BIGINT UNSIGNED NOT NULL COMMENT '绯荤粺鐢ㄦ埛ID',
  profile_id BIGINT UNSIGNED NOT NULL COMMENT 'SF6妗ｆID',
  alias_name VARCHAR(80) NULL COMMENT '鐢ㄦ埛鑷畾涔夊埆鍚?,
  is_primary TINYINT(1) NOT NULL DEFAULT 0 COMMENT '鏄惁涓昏处鍙凤紙1鏄紝0鍚︼級',
  track_enabled TINYINT(1) NOT NULL DEFAULT 1 COMMENT '鏄惁鍚敤璺熻釜锛?鍚敤锛?绂佺敤锛?,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '鍒涘缓鏃堕棿',
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '鏇存柊鏃堕棿',
  UNIQUE KEY uq_user_profile (user_id, profile_id),
  KEY idx_binding_user (user_id, is_primary),
  CONSTRAINT fk_binding_user FOREIGN KEY (user_id) REFERENCES app_users (id) ON DELETE CASCADE,
  CONSTRAINT fk_binding_profile FOREIGN KEY (profile_id) REFERENCES sf6_profiles (id) ON DELETE CASCADE
) ENGINE = InnoDB COMMENT='绯荤粺鐢ㄦ埛涓嶴F6妗ｆ缁戝畾鍏崇郴';

CREATE TABLE IF NOT EXISTS sf6_profile_state (
  profile_id BIGINT UNSIGNED PRIMARY KEY COMMENT 'SF6妗ｆID',
  total_matches INT NOT NULL DEFAULT 0 COMMENT '鏈湴鎴樼哗鎬诲満娆?,
  wins INT NOT NULL DEFAULT 0 COMMENT '鑳滃満鏁?,
  losses INT NOT NULL DEFAULT 0 COMMENT '璐熷満鏁?,
  draws INT NOT NULL DEFAULT 0 COMMENT '骞冲眬鏁?,
  win_rate DECIMAL(6, 2) NULL COMMENT '鑳滅巼锛堢櫨鍒嗘瘮锛?,
  new_added INT NOT NULL DEFAULT 0 COMMENT '鏈鏂板瀵规垬鏉＄洰鏁?,
  request_mode VARCHAR(16) NULL COMMENT '鏈€杩戝悓姝ユā寮忥紙full/minimal锛?,
  play_sync_error VARCHAR(500) NULL COMMENT '鍩烘湰璧勬枡鍚屾閿欒淇℃伅',
  raw_json JSON NULL COMMENT '鍘熷鑱氬悎JSON锛堣皟璇?鍏滃簳锛?,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '鏇存柊鏃堕棿',
  CONSTRAINT fk_profile_state_profile FOREIGN KEY (profile_id) REFERENCES sf6_profiles (id) ON DELETE CASCADE
) ENGINE = InnoDB COMMENT='SF6妗ｆ褰撳墠鑱氬悎鐘舵€?;

CREATE TABLE IF NOT EXISTS sf6_sync_runs (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT COMMENT '鍚屾浠诲姟涓婚敭ID',
  profile_id BIGINT UNSIGNED NOT NULL COMMENT 'SF6妗ｆID',
  triggered_by_user_id BIGINT UNSIGNED NULL COMMENT '瑙﹀彂鍚屾鐨勭郴缁熺敤鎴稩D',
  request_mode ENUM('full', 'minimal') NOT NULL COMMENT '鍚屾妯″紡锛歠ull鍏ㄩ噺/minimal澧為噺',
  status ENUM('running', 'success', 'failed') NOT NULL COMMENT '浠诲姟鐘舵€?,
  phase VARCHAR(32) NULL COMMENT '浠诲姟闃舵锛坆attlelog/profile绛夛級',
  page_last INT NULL COMMENT '鏈€鍚庡鐞嗛〉鐮?,
  page_cap INT NULL COMMENT '椤垫暟涓婇檺',
  fetched_count INT NOT NULL DEFAULT 0 COMMENT '鎶撳彇鎬绘潯鏁?,
  new_added_count INT NOT NULL DEFAULT 0 COMMENT '鏂板鏉℃暟',
  stop_reason VARCHAR(64) NULL COMMENT '鍋滄鍘熷洜',
  warning_text VARCHAR(255) NULL COMMENT '璀﹀憡淇℃伅',
  error_text VARCHAR(500) NULL COMMENT '閿欒淇℃伅',
  started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '寮€濮嬫椂闂?,
  completed_at DATETIME(3) NULL COMMENT '瀹屾垚鏃堕棿',
  KEY idx_sync_profile_time (profile_id, started_at DESC),
  KEY idx_sync_status (status, started_at DESC),
  KEY idx_sync_user_profile_mode (triggered_by_user_id, profile_id, request_mode, status, completed_at),
  CONSTRAINT fk_sync_profile FOREIGN KEY (profile_id) REFERENCES sf6_profiles (id) ON DELETE CASCADE,
  CONSTRAINT fk_sync_user FOREIGN KEY (triggered_by_user_id) REFERENCES app_users (id) ON DELETE SET NULL
) ENGINE = InnoDB COMMENT='鍚屾浠诲姟杩愯鍘嗗彶';

CREATE TABLE IF NOT EXISTS sf6_matches (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT COMMENT '瀵规垬璁板綍涓婚敭ID',
  profile_id BIGINT UNSIGNED NOT NULL COMMENT 'SF6妗ｆID',
  replay_id VARCHAR(40) NOT NULL COMMENT '鍥炴斁ID锛堝悓妗ｆ鍞竴锛?,
  played_at DATETIME(3) NULL COMMENT '瀵规垬鏃堕棿',
  result ENUM('win', 'loss', 'draw', 'unknown') NOT NULL DEFAULT 'unknown' COMMENT '瀵规垬缁撴灉',
  raw_result_json JSON NULL COMMENT '鍘熷鍥炲悎缁撴灉JSON',
  mode_text VARCHAR(64) NULL COMMENT '妯″紡鏂囨湰锛堟帓浣?浼戦棽绛夛級',
  my_character_name VARCHAR(64) NULL COMMENT '鎴戞柟瑙掕壊鍚?,
  opponent_character_name VARCHAR(64) NULL COMMENT '瀵规墜瑙掕壊鍚?,
  opponent_name VARCHAR(64) NULL COMMENT '瀵规墜鏄电О/FighterID',
  my_league_point INT NULL COMMENT '褰撴椂鎴戞柟LP',
  my_master_rating INT NULL COMMENT '褰撴椂鎴戞柟MR',
  league_point_delta INT NULL COMMENT 'LP鍙樺寲鍊?,
  master_rating_delta INT NULL COMMENT 'MR鍙樺寲鍊?,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '鍒涘缓鏃堕棿',
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '鏇存柊鏃堕棿',
  UNIQUE KEY uq_profile_replay (profile_id, replay_id),
  KEY idx_matches_profile_time (profile_id, played_at DESC),
  KEY idx_matches_profile_mode_time (profile_id, mode_text, played_at DESC),
  CONSTRAINT fk_matches_profile FOREIGN KEY (profile_id) REFERENCES sf6_profiles (id) ON DELETE CASCADE
) ENGINE = InnoDB COMMENT='瀵规垬鏄庣粏琛紙璺ㄨ禌瀛ｆ槑缁嗭級';

CREATE TABLE IF NOT EXISTS sf6_known_replay_ids (
  profile_id BIGINT UNSIGNED NOT NULL COMMENT 'SF6妗ｆID',
  replay_id VARCHAR(40) NOT NULL COMMENT '宸茶鍥炴斁ID',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '鍐欏叆鏃堕棿',
  PRIMARY KEY (profile_id, replay_id),
  CONSTRAINT fk_known_replay_profile FOREIGN KEY (profile_id) REFERENCES sf6_profiles (id) ON DELETE CASCADE
) ENGINE = InnoDB COMMENT='宸叉姄鍙栧洖鏀綢D鍘婚噸琛?;

CREATE TABLE IF NOT EXISTS sf6_play_stats_snapshots (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT COMMENT '蹇収涓婚敭ID',
  profile_id BIGINT UNSIGNED NOT NULL COMMENT 'SF6妗ｆID',
  request_mode ENUM('full', 'minimal') NOT NULL COMMENT '鏈蹇収閲囬泦妯″紡',
  fetched_at DATETIME(3) NULL COMMENT '鍓嶇鎶撳彇鏃堕棿',
  current_season_id INT NULL COMMENT '褰撳墠璧涘ID',
  season_ids_json JSON NULL COMMENT '鍙敤璧涘ID鍒楄〃JSON',
  base_info_json JSON NULL COMMENT '鍩虹璧勬枡JSON',
  battle_stats_json JSON NULL COMMENT '鎴樻枟缁熻JSON锛堝凡褰掍竴锛?,
  battle_stats_raw_json JSON NULL COMMENT '鎴樻枟缁熻鍘熷JSON',
  warnings_json JSON NULL COMMENT '閲囬泦鍛婅JSON',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '鍏ュ簱鏃堕棿',
  KEY idx_snapshot_profile_time (profile_id, created_at DESC),
  CONSTRAINT fk_snapshot_profile FOREIGN KEY (profile_id) REFERENCES sf6_profiles (id) ON DELETE CASCADE
) ENGINE = InnoDB COMMENT='鍩烘湰璧勬枡蹇収涓昏〃';

CREATE TABLE IF NOT EXISTS sf6_season_character_winrates (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT COMMENT '璧涘瑙掕壊鑳滅巼涓婚敭ID',
  snapshot_id BIGINT UNSIGNED NOT NULL COMMENT '蹇収ID',
  profile_id BIGINT UNSIGNED NOT NULL COMMENT 'SF6妗ｆID',
  season_id INT NOT NULL COMMENT '璧涘ID',
  mode_id TINYINT UNSIGNED NOT NULL COMMENT '妯″紡ID锛?鍏ㄩ儴/2鎺掍綅/3浼戦棽/4姣旇禌闂?5鏍兼枟涓績锛?,
  character_id INT NULL COMMENT '瑙掕壊ID锛堝畼鏂癸級',
  character_tool_name VARCHAR(64) NOT NULL COMMENT '瑙掕壊宸ュ叿鍚嶏紙鍞竴閿級',
  character_name VARCHAR(64) NULL COMMENT '瑙掕壊鍚嶇О锛堟湰鍦板寲锛?,
  character_alpha VARCHAR(64) NULL COMMENT '瑙掕壊鑻辨枃鍚?鍒悕',
  character_sort INT NULL COMMENT '瑙掕壊鎺掑簭鍙?,
  battle_count INT NOT NULL DEFAULT 0 COMMENT '瀵规垬鍦烘',
  win_count INT NOT NULL DEFAULT 0 COMMENT '鑳滃満鏁?,
  UNIQUE KEY uq_winrate_row (snapshot_id, season_id, mode_id, character_tool_name),
  KEY idx_winrate_profile_lookup (profile_id, season_id, mode_id, battle_count DESC),
  CONSTRAINT fk_winrate_snapshot FOREIGN KEY (snapshot_id) REFERENCES sf6_play_stats_snapshots (id) ON DELETE CASCADE,
  CONSTRAINT fk_winrate_profile FOREIGN KEY (profile_id) REFERENCES sf6_profiles (id) ON DELETE CASCADE
) ENGINE = InnoDB COMMENT='璧涘-妯″紡-瑙掕壊鑳滅巼浜嬪疄琛?;

CREATE TABLE IF NOT EXISTS sf6_season_character_leagues (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT COMMENT '璧涘瑙掕壊娈典綅涓婚敭ID',
  snapshot_id BIGINT UNSIGNED NOT NULL COMMENT '蹇収ID',
  profile_id BIGINT UNSIGNED NOT NULL COMMENT 'SF6妗ｆID',
  season_id INT NOT NULL COMMENT '璧涘ID',
  character_id INT NULL COMMENT '瑙掕壊ID锛堝畼鏂癸級',
  character_tool_name VARCHAR(64) NOT NULL COMMENT '瑙掕壊宸ュ叿鍚?,
  character_name VARCHAR(64) NULL COMMENT '瑙掕壊鍚嶇О锛堟湰鍦板寲锛?,
  character_alpha VARCHAR(64) NULL COMMENT '瑙掕壊鑻辨枃鍚?鍒悕',
  character_sort INT NULL COMMENT '瑙掕壊鎺掑簭鍙?,
  is_played TINYINT(1) NOT NULL DEFAULT 0 COMMENT '鏄惁娓哥帺杩囪瑙掕壊',
  league_point INT NULL COMMENT 'LP鍒嗗€?,
  league_rank INT NULL COMMENT '娈典綅缂栧彿',
  master_league INT NULL COMMENT 'Master鑱旇禌绾у埆',
  master_rating INT NULL COMMENT 'MR鍒嗗€?,
  master_rating_ranking INT NULL COMMENT 'MR鎺掑悕',
  UNIQUE KEY uq_league_row (snapshot_id, season_id, character_tool_name),
  KEY idx_league_profile_lookup (profile_id, season_id, league_point DESC, master_rating DESC),
  CONSTRAINT fk_league_snapshot FOREIGN KEY (snapshot_id) REFERENCES sf6_play_stats_snapshots (id) ON DELETE CASCADE,
  CONSTRAINT fk_league_profile FOREIGN KEY (profile_id) REFERENCES sf6_profiles (id) ON DELETE CASCADE
) ENGINE = InnoDB COMMENT='璧涘-瑙掕壊娈典綅绉垎浜嬪疄琛?;

CREATE TABLE IF NOT EXISTS sf6_season_rival_winrates (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT COMMENT '瑙掕壊瀵逛綅鑳滅巼涓婚敭ID',
  snapshot_id BIGINT UNSIGNED NOT NULL COMMENT '蹇収ID',
  profile_id BIGINT UNSIGNED NOT NULL COMMENT 'SF6妗ｆID',
  season_id INT NOT NULL COMMENT '璧涘ID',
  mode_id TINYINT UNSIGNED NOT NULL COMMENT '妯″紡ID锛?鍏ㄩ儴/2鎺掍綅/3浼戦棽/4姣旇禌闂?5鏍兼枟涓績锛?,
  my_character_tool_name VARCHAR(64) NOT NULL COMMENT '鎴戞柟瑙掕壊宸ュ叿鍚?,
  my_character_name VARCHAR(64) NULL COMMENT '鎴戞柟瑙掕壊鍚?,
  rival_character_tool_name VARCHAR(64) NOT NULL COMMENT '瀵规墜瑙掕壊宸ュ叿鍚?,
  rival_character_name VARCHAR(64) NULL COMMENT '瀵规墜瑙掕壊鍚?,
  battle_count INT NOT NULL DEFAULT 0 COMMENT '瀵逛綅鍦烘',
  win_count INT NOT NULL DEFAULT 0 COMMENT '瀵逛綅鑳滃満',
  UNIQUE KEY uq_rival_row (snapshot_id, season_id, mode_id, my_character_tool_name, rival_character_tool_name),
  KEY idx_rival_profile_lookup (profile_id, season_id, mode_id, my_character_tool_name, battle_count DESC),
  CONSTRAINT fk_rival_snapshot FOREIGN KEY (snapshot_id) REFERENCES sf6_play_stats_snapshots (id) ON DELETE CASCADE,
  CONSTRAINT fk_rival_profile FOREIGN KEY (profile_id) REFERENCES sf6_profiles (id) ON DELETE CASCADE
) ENGINE = InnoDB COMMENT='璧涘-妯″紡-瑙掕壊瀵逛綅鑳滅巼浜嬪疄琛?;

CREATE TABLE IF NOT EXISTS sf6_achievement_metrics_latest (
  profile_id BIGINT UNSIGNED NOT NULL COMMENT 'SF6妗ｆID',
  metric_key VARCHAR(100) NOT NULL COMMENT '鎸囨爣閿悕',
  metric_value_num DECIMAL(20, 6) NULL COMMENT '鏁板€煎瀷鎸囨爣鍊?,
  metric_value_text VARCHAR(255) NULL COMMENT '鏂囨湰鍨嬫寚鏍囧€?,
  metric_value_bool TINYINT(1) NULL COMMENT '甯冨皵鍨嬫寚鏍囧€硷紙1/0锛?,
  value_type ENUM('number', 'text', 'bool') NOT NULL COMMENT '鍊肩被鍨?,
  snapshot_id BIGINT UNSIGNED NOT NULL COMMENT '鏉ユ簮蹇収ID',
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '鏇存柊鏃堕棿',
  PRIMARY KEY (profile_id, metric_key),
  KEY idx_achievement_snapshot (snapshot_id),
  CONSTRAINT fk_achievement_profile FOREIGN KEY (profile_id) REFERENCES sf6_profiles (id) ON DELETE CASCADE,
  CONSTRAINT fk_achievement_snapshot FOREIGN KEY (snapshot_id) REFERENCES sf6_play_stats_snapshots (id) ON DELETE CASCADE
) ENGINE = InnoDB COMMENT='鏍兼枟鎴愬氨鏈€鏂版寚鏍囪〃锛堟寜妗ｆ+鎸囨爣鍞竴锛?;

ALTER TABLE app_users COMMENT = '绯荤粺鐢ㄦ埛琛?;
ALTER TABLE app_user_profiles COMMENT = '鐢ㄦ埛鎵╁睍璧勬枡琛?;
ALTER TABLE sf6_profiles COMMENT = 'SF6妗ｆ涓昏〃锛堟寜sid鍞竴锛?;
ALTER TABLE user_sf6_profile_bindings COMMENT = '绯荤粺鐢ㄦ埛涓嶴F6妗ｆ缁戝畾鍏崇郴';
ALTER TABLE sf6_profile_state COMMENT = 'SF6妗ｆ褰撳墠鑱氬悎鐘舵€?;
ALTER TABLE sf6_sync_runs COMMENT = '鍚屾浠诲姟杩愯鍘嗗彶';
ALTER TABLE sf6_matches COMMENT = '瀵规垬鏄庣粏琛紙璺ㄨ禌瀛ｆ槑缁嗭級';
ALTER TABLE sf6_known_replay_ids COMMENT = '宸叉姄鍙栧洖鏀綢D鍘婚噸琛?;
ALTER TABLE sf6_play_stats_snapshots COMMENT = '鍩烘湰璧勬枡蹇収涓昏〃';
ALTER TABLE sf6_season_character_winrates COMMENT = '璧涘-妯″紡-瑙掕壊鑳滅巼浜嬪疄琛?;
ALTER TABLE sf6_season_character_leagues COMMENT = '璧涘-瑙掕壊娈典綅绉垎浜嬪疄琛?;
ALTER TABLE sf6_season_rival_winrates COMMENT = '璧涘-妯″紡-瑙掕壊瀵逛綅鑳滅巼浜嬪疄琛?;
ALTER TABLE sf6_achievement_metrics_latest COMMENT = '鏍兼枟鎴愬氨鏈€鏂版寚鏍囪〃锛堟寜妗ｆ+鎸囨爣鍞竴锛?;
