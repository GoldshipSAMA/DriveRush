package com.driverush.cloudsync.common;

import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class ApiExceptionHandler {

  @ExceptionHandler(ApiException.class)
  public ResponseEntity<Map<String, Object>> handleApiException(ApiException ex) {
    return ResponseEntity.status(ex.getStatus()).body(Map.of(
      "error", ex.getMessage(),
      "status", ex.getStatus().value()
    ));
  }

  @ExceptionHandler(MethodArgumentNotValidException.class)
  public ResponseEntity<Map<String, Object>> handleValidation(MethodArgumentNotValidException ex) {
    String msg = ex.getBindingResult().getFieldErrors().stream()
      .findFirst()
      .map(e -> e.getField() + " " + e.getDefaultMessage())
      .orElse("请求参数校验失败");
    return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of(
      "error", msg,
      "status", HttpStatus.BAD_REQUEST.value()
    ));
  }

  @ExceptionHandler(Exception.class)
  public ResponseEntity<Map<String, Object>> handleOther(Exception ex) {
    return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of(
      "error", ex.getMessage() == null ? "服务器内部错误" : ex.getMessage(),
      "status", HttpStatus.INTERNAL_SERVER_ERROR.value()
    ));
  }
}
