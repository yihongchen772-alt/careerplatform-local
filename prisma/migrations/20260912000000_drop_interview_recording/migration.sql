-- 面试录音 (InterviewRecording) shipped in v0.14.0 for a few minutes and was
-- pulled before v0.14.1. Fresh installs never get the table (its create
-- migration is gone); this only cleans up a database that ran v0.14.0.
DROP TABLE IF EXISTS "InterviewRecording";
