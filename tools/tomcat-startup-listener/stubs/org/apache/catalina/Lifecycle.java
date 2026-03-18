package org.apache.catalina;

public interface Lifecycle {
    String AFTER_START_EVENT = "after_start";
    String BEFORE_STOP_EVENT = "before_stop";
    String AFTER_STOP_EVENT = "after_stop";
}