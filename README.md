# TIME.BLOCK

2D 영상(MP4)의 시간축을 z축으로 바꿔 프레임을 적층한 3D "Time Block"으로 시각화하고 MP4로 내보내는 브라우저 웹앱.
영상 처리는 모두 브라우저 로컬에서 수행한다 (세그멘테이션 모델 파일만 Google CDN에서 받음). 명세: `TIMEBLOCK_WEBAPP_SPEC.md`.

## 실행

```bash
npm install      # postinstall이 MediaPipe wasm을 public/mediapipe로 복사
npm run dev      # http://localhost:5173
npm run build    # 타입 체크 + dist/ 정적 빌드 (Netlify)
```

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

## 구조

```
src/
├─ main.ts             앱 연결: 샘플링 → 마스크 → 정렬 → 렌더, 미리보기/내보내기 공용 renderAt(t)
├─ state.ts            모든 파라미터의 단일 상태 저장소, 출력 해상도, Intensity 스케일
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
