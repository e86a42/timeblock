# TIME.BLOCK

2D 영상(MP4)의 시간축을 z축으로 바꿔 프레임을 적층한 3D "Time Block"으로 시각화하고 MP4로 내보내는 브라우저 웹앱.
영상 처리는 모두 브라우저 로컬에서 수행한다 (세그멘테이션 모델 파일만 Google CDN에서 받음). 명세: `TIMEBLOCK_WEBAPP_SPEC.md`.

## 실행

```bash
npm install      # postinstall이 MediaPipe wasm을 public/mediapipe로 복사
npm run dev      # http://localhost:5173
npm run build    # 타입 체크 + dist/ 정적 빌드 (Netlify)
```

배포: https://e86a42.github.io/timeblock/ — `main`에 푸시하면 GitHub Actions(`.github/workflows/deploy.yml`)가
`BASE_PATH=/timeblock/`로 빌드해 GitHub Pages에 올린다.

데스크톱 Chrome/Edge, 최소 너비 1280px.
조작: 우클릭 드래그 회전 · 휠 줌 · 중클릭 이동 · Space 재생/정지.

## 진행 상황

| 마일스톤 | 내용 | 상태 |
|---|---|---|
| M1 | 셋업, MP4 업로드·디코딩, 배경 On 적층 미리보기 | 완료 |
| M2 | 파라미터 창(Canvas·Time Block·Camera), 화면 비율·배경색 | 완료 |
| M3 | MP4 내보내기 (오프라인 렌더 + Mediabunny, WebM 대체) | 완료 |
| M4 | 배경 Off (MediaPipe 마스크) + Mask feather | 완료 |
| M5 | Anchor 정렬, 카메라 애니메이션, 원본 PIP + 추적 박스, 프리셋 | 완료 |
| P2 | 깊이 기반 적층, Unfold, PNG/OBJ 내보내기 | 미착수 |

## GLB 모드 (ROM.VIZ 스타일 → 레퍼런스 스타일 전환)

애니메이션이 있는 리깅된 GLB를 놓으면 GLB 모드로 바뀌고, 한 장면에서 세 단계가 이어진다 (Sequence 섹션에서 초 단위 조절).

1. **고스트 적층** — 클립을 일정 간격으로 샘플링한 포즈를 하나의 메시로 굳혀 Unfold 축을 따라 배치.
   TimeBlock의 Opacity·Falloff·Color over time·Blend·Build-up이 그대로 적용되고, 현재 포즈(텍스처)가 스택을 따라 움직임.
2. **면 형성** — 스윕 평면이 시간축을 지나가며 관절 경로선을 그리고, 체인 단면을 한 줄씩 이어 면을 만든다
   (Silhouette loop 체인은 닫힌 고리라 튜브가 됨).
3. **점 튜브** — 면 격자가 점으로 바뀌고, 시간축이 세로로 서며 화면을 채우고, 배경이 종이색 + 그레인으로 바뀐다.
   행(시점)마다 중심을 기준으로 숨 쉬듯 부풀고, 띠가 시간축을 따라 흐른다 (음악 대신 결정론적 노이즈).

- 영상과 GLB를 둘 다 불러오면 Source 패널의 **영상 | GLB** 전환으로 오갈 수 있다. 둘 다 메모리에 유지되고
  (프레임·마스크 재계산 없음), 모드별로 In/Out 구간과 Duration을 따로 기억한다.
  피사체 추적·배경 제거·PIP(Subject / Source PIP / Source background)는 영상 모드 전용이라 GLB 모드에서는 숨겨진다.
- 스키닝은 직접 계산해 영향 본 8개(JOINTS_0/1)까지 반영 (three.js GPU 스키닝은 4개까지). 현재 포즈만 three.js 스키닝 사용.
- 본 이름은 Mixamo(`mixamorig:LeftArm`), `l_arm_JNT`, `upperarm_l` 등 흔한 규칙을 자동 인식.
- Draco·Meshopt 압축 GLB 지원 (Draco 디코더는 `public/draco`로 복사해 로컬 제공).
- 출력은 영상 모드와 같은 `renderAt(t)` 경로라 미리보기와 MP4가 프레임 단위로 일치.

## 구조

```
src/
├─ main.ts             앱 연결: 샘플링 → 마스크 → 정렬 → 렌더, 미리보기/내보내기 공용 renderAt(t)
├─ state.ts            모든 파라미터의 단일 상태 저장소, 출력 해상도, Intensity 스케일
├─ glb/rig.ts          GLB 로드, 본/체인 인식, 포즈 샘플링, 8-influence 고스트 베이크
├─ glb/stage.ts        고스트 → 경로/면 → 점 튜브 단계와 시퀀서
├─ glb/shaders/        ghost · surface · lines · points · grain(종이 질감)
├─ io/decode.ts        Mediabunny(WebCodecs) 프레임 샘플링, 실패 시 <video> 시크로 대체
├─ io/exportMp4.ts     오프라인 렌더 → CanvasSource → MP4(H.264) / WebM(VP9)
├─ vision/segment.ts   MediaPipe Image Segmenter (VIDEO 모드), 첫 사용 시 지연 로드
├─ vision/align.ts     마스크 통계(무게중심·하단·bbox), Anchor 오프셋
├─ scene/stack.ts      DataArrayTexture + 인스턴싱 슬라이스, 프레임 사이 보간
├─ scene/shaders/      적층 셰이더 (보간 · 마스크/Feather · 감쇠 · 색조 · Build-up · Anchor)
├─ scene/camera.ts     Persp/Ortho, 뷰 프리셋, Orbit/Dolly 애니메이션
├─ scene/pip.ts        원본 PIP + 추적 박스 (미리보기·출력 동일)
└─ ui/                 controls.ts(바인딩 컨트롤), panel.ts, timeline.ts, presets.ts
```

## 동작 메모

- **보간(Interpolate)**: 샘플 프레임 사이에 슬라이스를 ×N으로 채워 연속된 볼륨처럼 보이게 함. 슬라이스별 불투명도는
  `1 − (1 − a)^(1/N)`이라 N을 바꿔도 전체 밀도는 같다. 프레임 수는 최대 600, "원본 프레임 전부 사용" 버튼 제공.
- **Intensity**: 0.6 기준(×1). `Int→Opacity`, `Int→Spacing`으로 각 항목에 대한 영향도를 0–1로 조절.
- **Opacity**: Opacity(프레임당) · Falloff · Curve(감쇠 지수) · 현재 프레임 Opacity · 현재 프레임 배경 유지.
- **Orbit**: Start(시작 각도) · Angle(회전량) · Direction · Easing. Dolly는 From/To 배율.
- **Build-up**: 초 단위. 완성 후 Duration 끝까지 유지. 기본은 Duration 연동, 슬라이더를 만지면 고정.
- **프리셋**: Preset 메뉴 → "현재 설정을 프리셋으로 저장…"으로 이름을 붙여 브라우저(localStorage)에 저장하고,
  "내 프리셋" 그룹에서 바로 적용. 관리 창에서 적용·갱신(현재 설정으로 덮어쓰기)·삭제. 영상 구간 In/Out과 파일 이름은
  영상마다 다르므로 저장하지 않음. 다른 기기로 옮길 때는 JSON 내보내기/불러오기 사용.
- **마스크 모델**: General(DeepLab v3, 테이블·의자 등 배경 사물 제외) / Person(Selfie multiclass).
  배경 Off · Anchor · PIP 추적 박스 중 하나를 처음 켤 때 1회 계산하고, 샘플링이 바뀌면 다시 계산.
- **내보내기**: 미리보기와 같은 `renderAt(t)`로 프레임마다 렌더 후 인코딩 → 해상도·FPS·길이가 설정값과 정확히 일치.
  H.264 미지원 시 WebM으로 대체, WebCodecs 자체가 없으면 버튼 비활성화 + 사유 표시.
