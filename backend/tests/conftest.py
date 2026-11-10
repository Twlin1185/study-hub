"""테스트 공통 설정 — stage-58 Host 가드: TestClient의 기본 Host(`testserver`)를 허용한다.
앱(main) import 전에 설정돼야 하므로 모듈 머리에서 1회 실행한다(다른 픽스처 추가 0)."""
import os

os.environ.setdefault("STUDY_HUB_ALLOWED_HOSTS", "testserver")
