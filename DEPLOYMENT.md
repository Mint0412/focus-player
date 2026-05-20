# Focus Player 배포

이 앱은 YouTube API 키를 브라우저에 노출하지 않기 위해 Node 서버가 반드시 필요합니다. 정적 호스팅만 제공하는 서비스가 아니라 Node 웹 서비스를 선택하세요.

## Render 배포 설정

1. 이 프로젝트를 GitHub 저장소에 올립니다.
2. Render에서 새 Web Service 또는 Blueprint를 생성하고 저장소를 연결합니다.
3. 환경변수에 `YOUTUBE_API_KEY`를 등록합니다.
4. 선택적으로 `ADMIN_PASSWORD_HASH`를 환경변수로 등록하면 코드 기본값 대신 배포 환경의 관리자 비밀번호 해시를 사용할 수 있습니다.
5. 배포 후 제공되는 URL로 접속합니다.

Render가 `render.yaml`을 읽으면 다음 설정으로 실행됩니다.

- Build Command: `npm install`
- Start Command: `npm start`
- Runtime: Node

## 배포 후 확인

- `/api/config`가 `{"hasServerKey":true}`를 반환해야 합니다.
- 메인 화면에서 검색 결과가 표시되어야 합니다.
- `/admin`은 관리자 로그인이 필요합니다.
