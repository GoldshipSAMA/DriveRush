package com.driverush.cloudsync.auth;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Map;

import com.driverush.cloudsync.common.ApiException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AuthService {
  private static final RowMapper<UserRow> USER_ROW_MAPPER = (rs, rowNum) -> mapUser(rs);

  private final JdbcTemplate jdbcTemplate;
  private final PasswordEncoder passwordEncoder;
  private final JwtService jwtService;

  public AuthService(JdbcTemplate jdbcTemplate, PasswordEncoder passwordEncoder, JwtService jwtService) {
    this.jdbcTemplate = jdbcTemplate;
    this.passwordEncoder = passwordEncoder;
    this.jwtService = jwtService;
  }

  @Transactional
  public Map<String, Object> register(String email, String password) {
    String normalizedEmail = normalizeEmail(email);
    if (password == null || password.length() < 6) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "密码至少 6 位");
    }
    UserRow existing = findByEmail(normalizedEmail);
    if (existing != null) {
      throw new ApiException(HttpStatus.CONFLICT, "邮箱已注册");
    }

    jdbcTemplate.update(
      "INSERT INTO app_users (email, username, password_hash, status, full_sync_required, full_sync_reason, full_sync_updated_at, created_at, updated_at) " +
        "VALUES (?, NULL, ?, 'active', 1, 'new-user-requires-full-sync', NOW(3), NOW(3), NOW(3))",
      normalizedEmail,
      passwordEncoder.encode(password)
    );

    UserRow user = findByEmail(normalizedEmail);
    if (user == null) {
      throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "注册失败");
    }

    jdbcTemplate.update(
      "INSERT INTO app_user_profiles (user_id, display_name, locale, timezone, created_at, updated_at) VALUES (?, ?, 'zh-hans', 'Asia/Shanghai', NOW(3), NOW(3)) " +
        "ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), updated_at = NOW(3)",
      user.id(),
      user.email()
    );

    String token = jwtService.issueToken(user.id(), user.email());
    return buildAuthResponse(token, user);
  }

  @Transactional
  public Map<String, Object> login(String email, String password) {
    String normalizedEmail = normalizeEmail(email);
    UserRow user = findByEmail(normalizedEmail);
    if (user == null) {
      throw new ApiException(HttpStatus.UNAUTHORIZED, "邮箱或密码错误");
    }
    if (!"active".equalsIgnoreCase(user.status())) {
      throw new ApiException(HttpStatus.FORBIDDEN, "账号已禁用");
    }
    if (!passwordEncoder.matches(password == null ? "" : password, user.passwordHash())) {
      throw new ApiException(HttpStatus.UNAUTHORIZED, "邮箱或密码错误");
    }

    jdbcTemplate.update(
      "UPDATE app_users SET last_login_at = ?, updated_at = NOW(3) WHERE id = ?",
      Timestamp.from(Instant.now()),
      user.id()
    );

    String token = jwtService.issueToken(user.id(), user.email());
    return buildAuthResponse(token, user);
  }

  private UserRow findByEmail(String email) {
    return jdbcTemplate.query(
      "SELECT id, email, username, password_hash, status, full_sync_required, full_sync_reason, full_sync_updated_at " +
        "FROM app_users WHERE email = ? LIMIT 1",
      USER_ROW_MAPPER,
      email
    ).stream().findFirst().orElse(null);
  }

  private Map<String, Object> buildAuthResponse(String token, UserRow user) {
    return Map.of(
      "token", token,
      "user", Map.of(
        "id", user.id(),
        "email", user.email(),
        "username", user.username() == null ? "" : user.username(),
        "fullSyncRequired", user.fullSyncRequired(),
        "fullSyncReason", user.fullSyncReason() == null ? "" : user.fullSyncReason(),
        "fullSyncUpdatedAt", user.fullSyncUpdatedAt() == null ? "" : user.fullSyncUpdatedAt().toInstant().toString()
      )
    );
  }

  private String normalizeEmail(String email) {
    String value = email == null ? "" : email.trim().toLowerCase();
    if (value.isBlank() || !value.contains("@")) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "邮箱格式不正确");
    }
    return value;
  }

  private static UserRow mapUser(ResultSet rs) throws SQLException {
    return new UserRow(
      rs.getLong("id"),
      rs.getString("email"),
      rs.getString("username"),
      rs.getString("password_hash"),
      rs.getString("status"),
      rs.getInt("full_sync_required") != 0,
      rs.getString("full_sync_reason"),
      rs.getTimestamp("full_sync_updated_at")
    );
  }

  private record UserRow(
    long id,
    String email,
    String username,
    String passwordHash,
    String status,
    boolean fullSyncRequired,
    String fullSyncReason,
    Timestamp fullSyncUpdatedAt
  ) {
  }
}
