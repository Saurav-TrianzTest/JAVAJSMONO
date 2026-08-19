package com.trianz.reactnextjs;

import com.trianz.reactnextjs.service.HealthService;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class HealthServiceTest {

    @Test
    void statusReportsUp() {
        HealthService service = new HealthService();
        assertEquals("{\"status\":\"UP\"}", service.status());
    }
}
