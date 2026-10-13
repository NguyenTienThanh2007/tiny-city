"""Email delivery abstraction. Development inboxes are explicit and production forbids the sink."""
from dataclasses import dataclass
import smtplib
from email.message import EmailMessage
from typing import Protocol
from urllib.parse import quote

from .config import Settings


class EmailDeliveryError(RuntimeError):
    pass


@dataclass(frozen=True)
class OutboundEmail:
    to: str
    subject: str
    text: str
    html: str


class EmailSender(Protocol):
    def send(self, message: OutboundEmail) -> None: ...


class DisabledEmailSender:
    enabled = False

    def send(self, message: OutboundEmail) -> None:
        del message
        raise EmailDeliveryError('Email delivery is not configured.')


class MemoryEmailSender:
    """Test-only sender. It keeps messages in memory and never uses a real provider."""
    enabled = True

    def __init__(self):
        self.messages: list[OutboundEmail] = []

    def send(self, message: OutboundEmail) -> None:
        self.messages.append(message)


class DevelopmentEmailSink(MemoryEmailSender):
    pass


class SMTPEmailSender:
    enabled = True

    def __init__(self, settings: Settings):
        self.settings = settings

    def send(self, message: OutboundEmail) -> None:
        email = EmailMessage()
        email['Subject'] = message.subject
        email['From'] = self.settings.smtp_from_email
        email['To'] = message.to
        email.set_content(message.text)
        email.add_alternative(message.html, subtype='html')
        try:
            with smtplib.SMTP(self.settings.smtp_host, self.settings.smtp_port, timeout=15) as smtp:
                smtp.ehlo()
                if self.settings.smtp_use_starttls:
                    smtp.starttls()
                    smtp.ehlo()
                if self.settings.smtp_username:
                    smtp.login(self.settings.smtp_username, self.settings.smtp_password.get_secret_value())
                smtp.send_message(email)
        except (OSError, smtplib.SMTPException) as exc:
            raise EmailDeliveryError('The configured email provider could not deliver the message.') from exc


def create_email_sender(settings: Settings):
    if settings.auth_email_backend == 'smtp':
        return SMTPEmailSender(settings)
    if settings.auth_email_backend == 'dev_sink' and settings.app_env in ('development', 'test') and settings.dev_email_sink_enabled:
        return DevelopmentEmailSink()
    return DisabledEmailSender()


def verification_email(settings: Settings, display_name: str, token: str) -> OutboundEmail:
    url = f"{settings.frontend_base_url.rstrip('/')}/verify-email#token={quote(token)}"
    safe_name = display_name.replace('<', '&lt;').replace('>', '&gt;')
    return OutboundEmail(
        to='', subject='Verify your TINY CITY email',
        text=f"Hello {display_name},\n\nVerify your email to activate your TINY CITY account:\n{url}\n\nIf you did not create this account, ignore this email.",
        html=f"<p>Hello {safe_name},</p><p><a href=\"{url}\">Verify your email</a> to activate your TINY CITY account.</p><p>If you did not create this account, ignore this email.</p>",
    )


def password_reset_email(settings: Settings, display_name: str, token: str) -> OutboundEmail:
    url = f"{settings.frontend_base_url.rstrip('/')}/reset-password#token={quote(token)}"
    safe_name = display_name.replace('<', '&lt;').replace('>', '&gt;')
    return OutboundEmail(
        to='', subject='Reset your TINY CITY password',
        text=f"Hello {display_name},\n\nReset your TINY CITY password using this one-time link:\n{url}\n\nIf you did not request this, ignore this email.",
        html=f"<p>Hello {safe_name},</p><p><a href=\"{url}\">Reset your password</a> with this one-time link.</p><p>If you did not request this, ignore this email.</p>",
    )

    enabled = True
