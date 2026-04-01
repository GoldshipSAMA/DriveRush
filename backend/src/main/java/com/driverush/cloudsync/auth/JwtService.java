package com.driverush.cloudsync.auth;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;

import javax.crypto.SecretKey;

import com.driverush.cloudsync.common.ApiException;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

@Service
public class JwtService {
  private final SecretKey key;
  private final Duration ttl;

  public JwtService(
    @Value("${app.jwt.secret}") String secret,
    @Value("${app.jwt.ttl-hours:168}") long ttlHours
  ) {
    this.key = Keys.hmacShaKeyFor(hash256(secret == null ? "" : secret));
    this.ttl = Duration.ofHours(Math.max(ttlHours, 1));
  }

  public String issueToken(long userId, String email) {
    Instant now = Instant.now();
    return Jwts.builder()
      .subject(Long.toString(userId))
      .claim("email", email)
      .issuedAt(Date.from(now))
      .expiration(Date.from(now.plus(ttl)))
      .signWith(key)
      .compact();
  }

  public long requireUserIdFromAuthorization(String authorization) {
    if (authorization == null || authorization.isBlank()) {
      throw new ApiException(HttpStatus.UNAUTHORIZED, "缺少 Authorization");
    }
    String prefix = "Bearer ";
    if (!authorization.startsWith(prefix)) {
      throw new ApiException(HttpStatus.UNAUTHORIZED, "Authorization 格式错误");
    }
    String token = authorization.substring(prefix.length()).trim();
    if (token.isEmpty()) {
      throw new ApiException(HttpStatus.UNAUTHORIZED, "token 为空");
    }
    try {
      Claims claims = Jwts.parser().verifyWith(key).build().parseSignedClaims(token).getPayload();
      return Long.parseLong(claims.getSubject());
    } catch (Exception ex) {
      throw new ApiException(HttpStatus.UNAUTHORIZED, "token 无效或已过期");
    }
  }

  private static byte[] hash256(String secret) {
    try {
      MessageDigest digest = MessageDigest.getInstance("SHA-256");
      return digest.digest(secret.getBytes(StandardCharsets.UTF_8));
    } catch (NoSuchAlgorithmException ex) {
      throw new IllegalStateException("SHA-256 unavailable", ex);
    }
  }
}
