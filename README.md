# TIME.BLOCK

2D 영상(MP4)의 시간축을 z축으로 바꿔 프레임을 적층한 3D "Time Block"으로 시각화하는 브라우저 웹앱.
모든 처리는 브라우저 로컬에서 수행한다. 명세: `TIMEBLOCK_WEBAPP_SPEC.md`.

## 실행

```bash
npm install
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
| M3 | MP4 내보내기 (오프라인 렌더 + Mediabunny) | 예정 |
| M4 | 배경 Off (MediaPipe 마스크) + Mask feather | 예정 |
| M5 | Anchor 정렬, PIP, 프리셋 | 예정 (카메라 애니메이션은 M2에서 선구현) |

## 구조

```
src/
├─ main.ts            앱 연결: 렌더 루프, 파일 로드, 상태 → 씬 반영
├─ state.ts           모든 파라미터의 단일 상태 저장소 + 출력 해상도 계산
├─ io/decode.ts       <video> 시크 기반 균등 프레임 샘플링 → RGBA 버퍼
├─ scene/stack.ts     DataArrayTexture + 인스턴싱 평면 적층, 현재 프레임 강조
├─ scene/shaders/     적층 셰이더 (알파 · 감쇠 · 색조 · Build-up)
├─ scene/camera.ts    Persp/Ortho, 뷰 프리셋 맞춤, Orbit/Dolly 애니메이션
└─ ui/                controls.ts(바인딩 컨트롤), panel.ts, timeline.ts
```

## 구현 결정 (검토 필요)

- **Intensity**: 0.6을 기준(×1)으로 Spacing·Opacity를 선형 스케일 (0 → 납작/투명, 1 → ×1.67).
- **Opacity falloff**: `opacity × (1 − falloff × age)`, age는 최신 프레임 0 → 가장 오래된 프레임 1.
- **Orbit**: 선택한 View를 중심으로 ±angle/2 회전. 사선 45° + 90°이면 정면에서 시작해 측면으로 끝남.
- **Dolly**: 거리 ×1.12 → ×0.78 (smoothstep).
- **Build-up**: 재생 구간 전체에 걸쳐 선형으로 적층되며 마지막 프레임에서 완성.
- **작업 해상도**: 긴 변 720px, 프레임 버퍼 합계 512MB 초과 시 자동 축소 후 경고.
