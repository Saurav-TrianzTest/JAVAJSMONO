package com.trianz.reactnextjs.controller;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.trianz.reactnextjs.service.S3PresignedUrlService;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * Handles file upload requests by generating S3 pre-signed URLs
 * This enables direct browser-to-S3 uploads without routing through the container
 */
public class UploadController implements HttpHandler {

    private final S3PresignedUrlService s3Service = new S3PresignedUrlService();

    @Override
    public void handle(HttpExchange exchange) throws IOException {
        String path = exchange.getRequestURI().getPath();
        String method = exchange.getRequestMethod();

        if (path.endsWith("/presigned-url") && "POST".equals(method)) {
            handlePresignedUrlRequest(exchange);
        } else if (path.endsWith("/confirm") && "POST".equals(method)) {
            handleConfirmUpload(exchange);
        } else {
            sendResponse(exchange, 404, "{\"error\":\"Not found\"}");
        }
    }

    private void handlePresignedUrlRequest(HttpExchange exchange) throws IOException {
        try {
            // Read request body
            String requestBody = readRequestBody(exchange);
            
            // Parse file metadata from request (simplified - in production use JSON parser)
            String fileName = extractJsonValue(requestBody, "fileName");
            String fileType = extractJsonValue(requestBody, "fileType");
            
            // Generate pre-signed URL
            String response = s3Service.generatePresignedUrl(fileName, fileType);
            
            sendResponse(exchange, 200, response);
        } catch (Exception e) {
            String errorResponse = String.format("{\"error\":\"%s\"}", e.getMessage());
            sendResponse(exchange, 500, errorResponse);
        }
    }

    private void handleConfirmUpload(HttpExchange exchange) throws IOException {
        try {
            // Read request body
            String requestBody = readRequestBody(exchange);
            
            // Log successful upload (in production, update database, trigger workflows, etc.)
            String fileKey = extractJsonValue(requestBody, "fileKey");
            System.out.println("Upload confirmed for file: " + fileKey);
            
            sendResponse(exchange, 200, "{\"success\":true}");
        } catch (Exception e) {
            String errorResponse = String.format("{\"error\":\"%s\"}", e.getMessage());
            sendResponse(exchange, 500, errorResponse);
        }
    }

    private String readRequestBody(HttpExchange exchange) throws IOException {
        try (InputStream is = exchange.getRequestBody()) {
            return new String(is.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    private String extractJsonValue(String json, String key) {
        // Simplified JSON parsing - in production use proper JSON library
        String searchKey = "\"" + key + "\"";
        int keyIndex = json.indexOf(searchKey);
        if (keyIndex == -1) return "";
        
        int colonIndex = json.indexOf(":", keyIndex);
        int startQuote = json.indexOf("\"", colonIndex);
        int endQuote = json.indexOf("\"", startQuote + 1);
        
        if (startQuote != -1 && endQuote != -1) {
            return json.substring(startQuote + 1, endQuote);
        }
        return "";
    }

    private void sendResponse(HttpExchange exchange, int statusCode, String response) throws IOException {
        byte[] body = response.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.getResponseHeaders().set("Access-Control-Allow-Origin", "*");
        exchange.getResponseHeaders().set("Access-Control-Allow-Methods", "POST, OPTIONS");
        exchange.getResponseHeaders().set("Access-Control-Allow-Headers", "Content-Type");
        
        if ("OPTIONS".equals(exchange.getRequestMethod())) {
            exchange.sendResponseHeaders(204, -1);
        } else {
            exchange.sendResponseHeaders(statusCode, body.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(body);
            }
        }
    }
}
