# TIME.BLOCK — 2D 영상 → 시간 적층 3D 영상 변환 웹앱 개발 명세

> 이 문서는 Claude Code에 전달하는 개발 지시서입니다.
> 작성자: 현주홍 · 작성일: 2026-10-06
> 표기 규칙: **[추측성 정보]** = 레퍼런스 화면에서 역추론한 내용으로, 구현 중 검증 필요

---

## 1. 목표

사용자가 업로드한 2D 영상(MP4)을 **시간축(t)을 공간축(z)으로 바꿔 프레임을 겹겹이 쌓은 3D 덩어리("Time Block")**로 시각화하고, 그 결과를 **MP4 영상으로 내보내는** 브라우저 웹앱을 만든다.

- 모든 처리는 브라우저 로컬에서 수행한다 (서버 업로드 없음).
- 표현 방식은 기존 웹앱 **ROM.VIZ**(https://rangeofmotionviz.netlify.app/rom.html)와 동일한 계열이다. UI 톤, 패널 구성, 용어(Ghost Frames, Unfold, Anchor 등)를 ROM.VIZ와 맞춘다.

---

## 2. 레퍼런스

| # | 게시물 | 참고할 표현 |
|---|---|---|
| 1 | https://www.instagram.com/p/DeE7oqYMp76/ | 3D 형상이 시간에 따라 반투명하게 겹쳐 덩어리로 번짐 (깊이 기반 확장형) |
| 2 | https://www.instagram.com/p/Dd65S6Rurlq/ | 영상 한 장이 3D 공간 속 판(plane)으로 놓이고 피사체가 판을 따라 잔상을 남김 (배경 On) |
| 3 | https://www.instagram.com/p/DdurldXxktH/ | 피사체 실루엣을 프레임 순서대로 쌓은 3D 볼륨 + 원본 영상의 추적 박스 표시 (배경 Off) |
| 4 | https://www.instagram.com/p/DdpYiDtNFCi/ | 피사체만 분리해 와이어 박스 안에 시간 덩어리로 배치 (배경 Off) |

- 4번 게시물 댓글에서 시간 덩어리를 만들기 전 카메라 패닝 제거 필요성이 지적됨 → **흔들림 보정/정렬 기능 필요** (§5.4).

---

## 3. 기술 스택

| 영역 | 선택 | 근거 |
|---|---|---|
| 3D 렌더 | **Three.js** (ROM.VIZ와 동일, r168 이상) | ROM.VIZ 코드·UI 재사용 |
| 빌드 | **Vite + TypeScript** | 단일 페이지, 정적 배포(Netlify) |
| 피사체 분리 | **MediaPipe Image Segmenter** (`@mediapipe/tasks-vision`) — VIDEO 모드, `segmentForVideo()` | 브라우저 실행, 카테고리/신뢰도 마스크 출력 ([공식 문서](https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter/web_js)) |
| MP4 인코딩 | **Mediabunny** (WebCodecs 기반, H.264/AVC, MP4 컨테이너) | mp4-muxer의 후속 라이브러리, MPL-2.0 ([공식 문서](https://mediabunny.dev/guide/introduction)) |
| UI 패널 | 자체 구현 (ROM.VIZ 사이드 패널 스타일) 또는 lil-gui | 파라미터 창 필수 |

- 깊이 기반 모드(§5.6, P2)는 Depth Anything V2 Small + Transformers.js(WebGPU)를 사용한다. Small 모델만 Apache-2.0이다.
- **[추측성 정보]** WebCodecs H.264 인코딩은 Chrome/Edge 데스크톱에서 가장 안정적이다. Safari·Firefox는 구현 시 확인하고, 미지원 시 WebM 대체 출력 + 안내 메시지를 띄운다.

---

## 4. 기능 우선순위

### P0 — 필수 (MVP)
1. MP4 업로드 (드래그 앤 드롭)
2. 프레임 샘플링 및 시간 적층 3D 뷰
3. **배경 On/Off 토글** (배경 제거가 아니라 선택형)
4. **화면 비율 조정** (가로·세로·정사각 등)
5. **배경색 조정**
6. **효과 강도 파라미터 창**
7. **MP4 내보내기**

### P1 — 권장
8. 흔들림 보정 / 피사체 기준 정렬 (Anchor)
9. 카메라 애니메이션 프리셋 (궤도 회전, 돌리 인)
10. 원본 영상 PIP 오버레이 + 추적 박스 (레퍼런스 #3)
11. 프리셋 저장/불러오기 (JSON)

### P2 — 확장
12. 깊이 기반 3D 적층 (레퍼런스 #1)
13. Unfold Fan/Loop 모드 (ROM.VIZ 방식 이식)
14. PNG 스냅샷, OBJ 내보내기

---

## 5. 처리 파이프라인

```
MP4 업로드
  → 디코딩 & 프레임 샘플링 (§5.1)
  → [배경 Off일 때] 피사체 마스크 생성 (§5.2)
  → [선택] 정렬/보정 (§5.4)
  → 프레임 텍스처를 z축으로 적층 (§5.3)
  → Three.js 렌더 + 카메라 애니메이션
  → MP4 인코딩 & 다운로드 (§7)
```

### 5.1 디코딩 & 샘플링
- `<video>` + `requestVideoFrameCallback` 또는 Mediabunny 디코딩으로 프레임을 추출한다.
- 사용자가 지정한 **구간(In/Out)**과 **샘플 수(N)**로 균등 추출한다.
- 프레임은 작업 해상도(기본 긴 변 720px)로 축소해 GPU 텍스처로 보관한다.
- 진행률 바와 취소 버튼을 표시한다.

### 5.2 배경 On/Off
| 모드 | 동작 | 레퍼런스 |
|---|---|---|
| **On** | 원본 프레임 전체를 그대로 판(plane)으로 적층 | #2 |
| **Off** | MediaPipe 마스크로 피사체만 남기고 나머지를 투명 처리해 적층 | #3, #4 |

- 마스크는 배경 Off로 처음 전환할 때 한 번 계산하고 캐시한다. On/Off 전환 시 재계산하지 않는다.
- 마스크 가장자리 부드럽게(Feather) 파라미터를 제공한다.

### 5.3 시간 적층 (핵심)
- 프레임 i를 `z = i × spacing` 위치의 평면 메시로 배치한다.
- 셰이더에서 알파·색조·페이드를 처리한다 (§6 파라미터와 연결).
- 블렌딩 모드: Normal / Additive 선택.
- 성능을 위해 `InstancedMesh` 또는 `DataArrayTexture`(2D 텍스처 배열)를 사용한다.

### 5.4 정렬 / 흔들림 보정 (P1)
- ROM.VIZ의 **Anchor** 개념을 이식한다.
  - `None`: 원본 좌표 그대로
  - `Subject center`: 프레임별 마스크 무게중심을 기준으로 정렬
  - `Ground`: 마스크 하단 기준 정렬
- **[추측성 정보]** 카메라 패닝이 큰 영상은 무게중심 정렬만으로 충분하지 않을 수 있다. 1차 구현 후 결과를 보고 광학 흐름 기반 보정 여부를 결정한다.

### 5.6 깊이 기반 모드 (P2)
- 프레임별 깊이 맵을 추정해 평면을 변위(displacement)시키거나 포인트 클라우드로 적층한다.
- 깊이 출력은 상대 역깊이이므로 스케일 파라미터로 조정한다.

---

## 6. 파라미터 창 (필수)

우측 사이드 패널에 아래 그룹으로 배치한다. 모든 값은 **실시간 미리보기**에 즉시 반영한다.

### 6.1 Canvas (화면 비율 · 배경)
| 파라미터 | 타입 | 범위 / 옵션 | 기본값 |
|---|---|---|---|
| Aspect ratio | 선택 | 16:9 (가로), 9:16 (세로), 1:1, 4:5, 21:9, Custom | 9:16 |
| Custom W × H | 숫자 | 각 256–4096 px | — |
| Resolution | 선택 | 720p / 1080p / 1440p / 2160p (짧은 변 기준) | 1080p |
| Background color | 컬러피커 + HEX | — | #0B0D10 |
| Background gradient | 토글 + 2색 | — | Off |
| Source background | 토글 | **On / Off** (§5.2) | On |

- 비율을 바꾸면 미리보기 뷰포트가 레터박스 없이 해당 비율로 바뀐다.
- 미리보기 화면 = 최종 MP4 프레이밍 (WYSIWYG).

### 6.2 Time Block (효과 강도)
| 파라미터 | 설명 | 범위 | 기본값 |
|---|---|---|---|
| **Intensity** | 효과 전체 강도 (아래 값들을 일괄 스케일하는 마스터) | 0–1 | 0.6 |
| Frame count | 적층할 프레임 수 | 4–300 | 60 |
| Time range | 사용 구간 In/Out | 영상 길이 내 | 전체 |
| Spacing | 프레임 간 z 간격 | 0–50 (단위: 화면 높이 대비 %) | 2 |
| Opacity | 프레임별 불투명도 | 0–1 | 0.15 |
| Opacity falloff | 오래된 프레임일수록 흐려지는 정도 | 0–1 | 0.5 |
| Blend mode | Normal / Additive | — | Additive |
| Color over time | 시간에 따른 색조 그라데이션 | 토글 + 시작/끝 색 | Off |
| Mask feather | 마스크 가장자리 부드럽게 (배경 Off 전용) | 0–20 px | 4 |
| Highlight current | 현재 프레임만 불투명하게 강조 | 토글 | On |
| Bounding box | 와이어 박스 표시 (레퍼런스 #4) | 토글 + 색 | Off |

### 6.3 Camera
| 파라미터 | 범위 / 옵션 | 기본값 |
|---|---|---|
| Projection | Perspective / Orthographic | Perspective |
| FOV | 15–90° | 35° |
| View preset | 정면 / 측면 / 사선 45° / 탑 / 자유 | 사선 45° |
| Animation | None / Orbit / Dolly / Orbit+Dolly | Orbit |
| Orbit angle | 0–360° | 90° |
| Playback mode | Build-up (적층이 점점 쌓임) / Static (완성된 덩어리) | Build-up |

### 6.4 Export
| 파라미터 | 범위 / 옵션 | 기본값 |
|---|---|---|
| Format | **MP4 (H.264)** / WebM (대체) | MP4 |
| FPS | 24 / 30 / 60 | 30 |
| Duration | 1–60 s | 원본 구간 길이 |
| Bitrate | Low / Medium / High / Custom (Mbps) | High |
| File name | 텍스트 | `timeblock_YYYYMMDD_HHMM.mp4` |

### 6.5 프리셋
- 현재 파라미터 전체를 JSON으로 저장/불러오기.
- 기본 프리셋 3종: `Ghost Trail`(#1 계열), `Plane Stack`(#2 계열), `Silhouette Volume`(#3·#4 계열).

---

## 7. MP4 내보내기 명세 (필수)

- **오프라인 렌더링**: 실시간 녹화가 아니라 프레임 단위로 렌더 → 인코딩한다. 프레임 누락이 없어야 한다.
  1. 출력 해상도의 오프스크린 렌더 타깃을 만든다.
  2. `t = 0 … duration`을 `1/fps` 간격으로 진행하며 장면 상태(적층 진행도, 카메라)를 결정론적으로 계산한다.
  3. 각 프레임을 Mediabunny의 캔버스 소스로 인코딩한다.
  4. MP4로 마무리하고 다운로드한다.
- 출력 해상도와 비율은 §6.1 Canvas 설정을 그대로 따른다.
- 인코딩 중 진행률(%)·예상 남은 시간·취소 버튼을 표시한다.
- H.264 해상도 제약 때문에 가로·세로 픽셀 수는 **짝수**로 맞춘다.
- MP4(H.264)는 투명 배경을 지원하지 않으므로, 배경은 항상 §6.1 배경색으로 채운다.
- WebCodecs 미지원 브라우저에서는 MP4 버튼을 비활성화하고 사유를 표시한다.

---

## 8. UI 레이아웃

```
┌─────────────────────────────────────────────────────────┐
│ TIME.BLOCK                         [프리셋 ▾] [Export ▶] │
├──────────┬──────────────────────────────┬───────────────┤
│ Source   │                              │ Canvas        │
│ - 업로드  │      3D 미리보기 뷰포트       │ Time Block    │
│ - 썸네일  │   (선택한 비율로 고정 표시)    │ Camera        │
│ - In/Out │                              │ Export        │
│          │                              │ (접이식 그룹)  │
├──────────┴──────────────────────────────┴───────────────┤
│ 타임라인: ▶ ‖  0.00 / 12.00   [원본 PIP 토글]            │
└─────────────────────────────────────────────────────────┘
```

- 다크 테마 기본, ROM.VIZ와 같은 폰트·간격·컬러 톤.
- 뷰포트: 우클릭 드래그 회전, 휠 줌, 중클릭 이동 (ROM.VIZ 조작과 동일).
- 모바일은 대응하지 않는다 (데스크톱 전용, 최소 1280px).

---

## 9. 폴더 구조 (제안)

```
timeblock/
├─ index.html
├─ src/
│  ├─ main.ts
│  ├─ io/        decode.ts, exportMp4.ts
│  ├─ vision/    segment.ts, align.ts, depth.ts(P2)
│  ├─ scene/     stack.ts, shaders/, camera.ts
│  ├─ ui/        panel.ts, timeline.ts, presets.ts
│  └─ state.ts   # 모든 파라미터의 단일 상태 저장소
├─ public/models/
└─ README.md
```

---

## 10. 성능 기준

- 1080p, 12초, 60프레임 적층 기준:
  - 미리보기 30fps 이상 (일반 노트북 내장 GPU 기준) **[추측성 정보: 실제 장비에서 측정 후 조정]**
  - 마스크 계산은 진행률 표시와 함께 1회만 수행
- GPU 메모리 초과를 막기 위해 프레임 수 × 작업 해상도에 상한을 두고 경고한다.

---

## 11. 완료 기준 (Acceptance Criteria)

- [ ] MP4 업로드 후 30초 이내에 시간 적층 미리보기가 표시된다.
- [ ] 배경 On/Off 전환이 마스크 재계산 없이 즉시 반영된다.
- [ ] 16:9, 9:16, 1:1, 4:5, Custom 비율이 미리보기와 출력에 동일하게 적용된다.
- [ ] 배경색 변경이 미리보기와 출력 MP4에 동일하게 반영된다.
- [ ] Intensity 및 §6.2의 모든 파라미터가 실시간으로 반영된다.
- [ ] 내보낸 MP4가 QuickTime, VLC, Instagram 업로드에서 정상 재생된다.
- [ ] 내보낸 MP4의 해상도·FPS·길이가 설정값과 일치한다.
- [ ] 프리셋 JSON 저장 → 새로고침 → 불러오기 시 동일한 결과가 재현된다.

---

## 12. 개발 진행 방식 (Claude Code 지시)

1. **M1** — 프로젝트 셋업, MP4 업로드·디코딩, 배경 On 상태 적층 미리보기
2. **M2** — 파라미터 창(Canvas·Time Block·Camera) + 화면 비율·배경색
3. **M3** — MP4 내보내기 (오프라인 렌더 + Mediabunny)
4. **M4** — 배경 Off (MediaPipe 마스크) + Mask feather
5. **M5** — P1 기능 (Anchor 정렬, 카메라 애니메이션, PIP, 프리셋)

- 각 마일스톤 종료 시 로컬에서 실행 확인 후 커밋한다.
- 라이브러리 API는 구현 시점의 공식 문서로 다시 확인한다 (버전 변경 가능성).
- 불확실한 결정은 임의로 정하지 말고 질문으로 남긴다.

---

## 출처

- ROM.VIZ — https://rangeofmotionviz.netlify.app/rom.html
- MediaPipe Image Segmenter (Web) — https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter/web_js
- Mediabunny — https://mediabunny.dev/guide/introduction
- Depth Anything V2 — https://github.com/DepthAnything/Depth-Anything-V2
- 레퍼런스 영상 — §2 표의 Instagram 링크 4건 (2026-10-06 화면 확인)
