package com.driverush.cloudsync.auth;

import java.util.Map;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
  private final AuthService authService;

  public AuthController(AuthService authService) {
    this.authService = authService;
  }

  @PostMapping("/register")
  public Map<String, Object> register(@Valid @RequestBody AuthRequest request) {
    return authService.register(request.email(), request.password());
  }

  @PostMapping("/login")
  public Map<String, Object> login(@Valid @RequestBody AuthRequest request) {
    return authService.login(request.email(), request.password());
  }

  @PostMapping("/logout")
  public Map<String, Object> logout() {
    return Map.of("ok", true);
  }

  public record AuthRequest(
    @NotBlank @Email String email,
    @NotBlank @Size(min = 6, max = 128) String password
  ) {
  }
}
