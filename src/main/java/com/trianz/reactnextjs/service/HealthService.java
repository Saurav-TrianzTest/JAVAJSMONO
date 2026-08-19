package com.trianz.reactnextjs.service;

/** Reports the liveness status of the host application. */
public class HealthService {

    public String status() {
        return "{\"status\":\"UP\"}";
    }
}
