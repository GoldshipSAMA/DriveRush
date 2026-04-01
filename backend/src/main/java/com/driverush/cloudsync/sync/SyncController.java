package com.driverush.cloudsync.sync;

import java.util.Map;

import com.driverush.cloudsync.auth.JwtService;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/sync")
public class SyncController {
  private final JwtService jwtService;
  private final SyncService syncService;

  public SyncController(JwtService jwtService, SyncService syncService) {
    this.jwtService = jwtService;
    this.syncService = syncService;
  }

  @PostMapping("/import")
  public Map<String, Object> importData(
    @RequestHeader(value = "Authorization", required = false) String authorization,
    @RequestBody JsonNode payload
  ) {
    long userId = jwtService.requireUserIdFromAuthorization(authorization);
    return syncService.importPayload(userId, payload);
  }

  @GetMapping("/export")
  public Map<String, Object> exportData(
    @RequestHeader(value = "Authorization", required = false) String authorization
  ) {
    long userId = jwtService.requireUserIdFromAuthorization(authorization);
    return syncService.exportPayload(userId);
  }

  @GetMapping("/bootstrap")
  public Map<String, Object> getBootstrapState(
    @RequestHeader(value = "Authorization", required = false) String authorization
  ) {
    long userId = jwtService.requireUserIdFromAuthorization(authorization);
    return syncService.getBootstrapState(userId);
  }

  @PostMapping("/bootstrap")
  public Map<String, Object> setBootstrapState(
    @RequestHeader(value = "Authorization", required = false) String authorization,
    @Valid @RequestBody BootstrapRequest request
  ) {
    long userId = jwtService.requireUserIdFromAuthorization(authorization);
    return syncService.updateBootstrapState(userId, request.fullSyncRequired(), request.reason());
  }

  public record BootstrapRequest(
    @NotNull Boolean fullSyncRequired,
    String reason
  ) {
  }
}
