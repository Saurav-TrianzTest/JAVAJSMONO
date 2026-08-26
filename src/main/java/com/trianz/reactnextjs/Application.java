package com.trianz.reactnextjs;

import com.sun.net.httpserver.HttpServer;
import com.trianz.reactnextjs.controller.HealthController;
import com.trianz.reactnextjs.controller.UploadController;

import java.net.InetSocketAddress;

/**
 * Host application entry point for the react-nextjs-host module.
 *
 * This Java application is the enterprise host for the React + Next.js
 * frontend assets retained elsewhere in this repository (see
 * TRUTH_SOURCE_OF_TRUTH.txt). The frontend files are not compiled or
 * altered by this build — they exist purely so the CModernize scanner
 * can detect the seeded cz-js-1024..1047 containerization rule
 * violations while the repository is recognized as a single-module
 * Java (Maven) application.
 */
public class Application {

    public static void main(String[] args) throws Exception {
        int port = 8080;
        HttpServer server = HttpServer.create(new InetSocketAddress(port), 0);
        server.createContext("/api/health", new HealthController());
        server.createContext("/api/upload/presigned-url", new UploadController());
        server.createContext("/api/upload/confirm", new UploadController());
        server.setExecutor(null);
        server.start();
        System.out.println("react-nextjs-host listening on port " + port);
    }
}
