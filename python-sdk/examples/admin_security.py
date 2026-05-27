from remote_ai_access import RemoteAIAccessClient


def main() -> None:
    client = RemoteAIAccessClient(
        base_url="https://ai.tg11.org",
        api_key="YOUR_API_KEY",
        admin_token="YOUR_ADMIN_TOKEN",
    )

    security = client.admin_get_security_typed()
    print("api key auth enabled:", security.api_key_auth_enabled)
    print("protected prefixes:", security.protected_path_prefixes)


if __name__ == "__main__":
    main()
